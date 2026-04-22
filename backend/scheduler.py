"""
scheduler.py — Moteur de tâches autonomes (APScheduler + BudgetGuard).

Les tâches autonomes sont définies dans la table `scheduled_tasks` (source de vérité).
APScheduler utilise un MemoryJobStore (registre en mémoire, rechargé au démarrage depuis DB).
Le BudgetGuard vérifie les plafonds tokens et runs quotidiens avant chaque exécution.

Flux d'exécution :
  APScheduler timer → run_task_by_id(task_id) → BudgetGuard.check()
  → asyncio.create_task(_execute_mission(...)) → job enregistré en DB avec source=autonomous:{task_id}
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

# APScheduler — import optionnel pour ne pas bloquer le démarrage si absent
try:
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.jobstores.memory import MemoryJobStore
    _APS_OK = True
except ImportError:
    AsyncIOScheduler = None  # type: ignore[assignment,misc]
    MemoryJobStore = None  # type: ignore[assignment]
    _APS_OK = False
    logger.warning("apscheduler non installé — tâches autonomes désactivées. Exécuter : pip install apscheduler>=3.10.0")


# ── BudgetGuard ────────────────────────────────────────────────────────────────

class BudgetExceededError(Exception):
    """Levée quand un plafond de budget est atteint avant l'exécution."""


class BudgetGuard:
    """Vérifie les plafonds quotidiens (runs et tokens) avant chaque tâche autonome."""

    @staticmethod
    def check(task: dict) -> None:
        """
        Lève BudgetExceededError si l'une des limites est dépassée.
        Tolérant aux erreurs DB : en cas d'échec de lecture, laisse passer.
        """
        try:
            from database import count_autonomous_runs_today, sum_autonomous_tokens_today
            task_id = task["id"]
            max_runs = int(task.get("budget_runs_per_day") or 3)
            max_tokens = int(task.get("budget_tokens_per_run") or 50000)
            runs_today = count_autonomous_runs_today(task_id)
            if runs_today >= max_runs:
                raise BudgetExceededError(
                    f"Tâche {task_id!r} : plafond runs atteint ({runs_today}/{max_runs} aujourd'hui)"
                )
            tokens_today = sum_autonomous_tokens_today(task_id)
            daily_token_budget = max_tokens * max_runs
            if tokens_today >= daily_token_budget:
                raise BudgetExceededError(
                    f"Tâche {task_id!r} : plafond tokens atteint ({tokens_today}/{daily_token_budget} aujourd'hui)"
                )
        except BudgetExceededError:
            raise
        except Exception as exc:
            logger.warning("BudgetGuard : erreur lecture budget (tâche=%s) — %s", task.get("id"), exc)


# ── Exécution d'une mission autonome ──────────────────────────────────────────

class _CaptureBT:
    """Stub BackgroundTasks : capture la fonction execute() pour la lancer manuellement."""
    def __init__(self):
        self._tasks: list = []

    def add_task(self, func, *args, **kwargs):
        self._tasks.append((func, args, kwargs))


async def _execute_mission_async(task: dict) -> None:
    """Prépare et lance une mission via le moteur existant _schedule_mission_execution."""
    from services.mission import _schedule_mission_execution, _mission_config_from_payload

    job_id = str(uuid.uuid4())[:8]
    agent_key = str(task.get("agent") or "coordinateur")
    mission_text = str(task.get("mission_template") or "")
    source_tag = f"autonomous:{task['id']}"

    params = task.get("params") or {}
    mission_config = _mission_config_from_payload({
        "require_user_validation": False,
        "mode": str(params.get("mode") or "cio"),
        "cio_questions_enabled": False,
        "cio_plan_hitl_enabled": False,
    })

    bt = _CaptureBT()
    _schedule_mission_execution(
        bt,
        job_id,
        agent_key,
        mission_text,
        None,
        source_tag,
        mission_config=mission_config,
    )

    loop = asyncio.get_event_loop()
    for func, args, kwargs in bt._tasks:
        loop.run_in_executor(None, lambda f=func, a=args, k=kwargs: f(*a, **k))

    logger.info("Tâche autonome %r lancée → job %s", task["id"], job_id)
    return job_id


async def run_task_by_id(task_id: str) -> None:
    """Point d'entrée APScheduler : charge la tâche, vérifie le budget, exécute."""
    from database import get_scheduled_task, update_scheduled_task

    try:
        task = get_scheduled_task(task_id)
        if not task:
            logger.warning("Tâche autonome introuvable : %s", task_id)
            return
        if not task.get("enabled"):
            return

        BudgetGuard.check(task)

        task_type = str(task.get("task_type") or "mission")
        now_iso = datetime.utcnow().isoformat()
        update_scheduled_task(task_id, last_run_at=now_iso)

        if task_type == "veille":
            from services.veille import run_veille_task
            asyncio.create_task(run_veille_task(task))
        elif task_type == "mission_proposals":
            from services.veille import run_mission_proposals_task
            asyncio.create_task(run_mission_proposals_task(task))
        else:
            asyncio.create_task(_execute_mission_async(task))

    except BudgetExceededError as exc:
        logger.warning("Budget dépassé — tâche %s ignorée : %s", task_id, exc)
    except Exception as exc:
        logger.exception("Erreur inattendue lors de l'exécution de la tâche %s : %s", task_id, exc)


# ── Scheduler lifecycle ────────────────────────────────────────────────────────

def _build_trigger(task: dict):
    """Construit le trigger APScheduler à partir de schedule_type et schedule_config."""
    from apscheduler.triggers.interval import IntervalTrigger
    from apscheduler.triggers.cron import CronTrigger

    stype = str(task.get("schedule_type") or "interval")
    cfg = task.get("schedule_config") or {}

    if stype == "cron":
        return CronTrigger(**{k: v for k, v in cfg.items() if k in {
            "year", "month", "day", "week", "day_of_week",
            "hour", "minute", "second", "start_date", "end_date", "timezone",
        }})
    else:
        interval_kwargs = {k: v for k, v in cfg.items() if k in {
            "weeks", "days", "hours", "minutes", "seconds",
        }}
        if not interval_kwargs:
            interval_kwargs = {"hours": 24}
        return IntervalTrigger(**interval_kwargs)


def register_db_tasks(scheduler) -> None:
    """Charge toutes les tâches activées depuis la DB et les enregistre dans le scheduler."""
    try:
        from database import list_scheduled_tasks
        tasks = list_scheduled_tasks()
        for task in tasks:
            if not task.get("enabled"):
                continue
            _register_task(scheduler, task)
        logger.info("Scheduler : %d tâche(s) autonome(s) enregistrée(s)", len([t for t in tasks if t.get("enabled")]))
    except Exception as exc:
        logger.exception("Erreur lors du chargement des tâches autonomes : %s", exc)


def _register_task(scheduler, task: dict) -> None:
    """Enregistre ou remplace une tâche dans le scheduler runtime."""
    if not _APS_OK or scheduler is None:
        return
    task_id = task["id"]
    try:
        if scheduler.get_job(task_id):
            scheduler.remove_job(task_id)
    except Exception:
        pass
    try:
        trigger = _build_trigger(task)
        scheduler.add_job(
            run_task_by_id,
            trigger=trigger,
            id=task_id,
            args=[task_id],
            replace_existing=True,
            misfire_grace_time=3600,
        )
        logger.debug("Tâche schedulée : %s (%s)", task.get("name"), task_id)
    except Exception as exc:
        logger.error("Impossible d'enregistrer la tâche %s : %s", task_id, exc)


def unregister_task(scheduler, task_id: str) -> None:
    """Retire une tâche du scheduler runtime (sans toucher la DB)."""
    if not _APS_OK or scheduler is None:
        return
    try:
        if scheduler.get_job(task_id):
            scheduler.remove_job(task_id)
    except Exception:
        pass


def create_scheduler():
    """Crée et retourne l'instance AsyncIOScheduler (ou None si APScheduler absent)."""
    if not _APS_OK:
        return None
    scheduler = AsyncIOScheduler(
        jobstores={"default": MemoryJobStore()},
        job_defaults={"coalesce": True, "max_instances": 1},
        timezone="UTC",
    )
    return scheduler


# Singleton global référencé par le router pour add/remove dynamique
_scheduler_instance = None


def get_scheduler():
    return _scheduler_instance


def set_scheduler(s) -> None:
    global _scheduler_instance
    _scheduler_instance = s
