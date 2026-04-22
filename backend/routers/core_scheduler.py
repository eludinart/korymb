"""
routers/core_scheduler.py — CRUD tâches autonomes planifiées + file d'approbation.

Endpoints :
  GET    /scheduler/tasks               — liste des tâches
  POST   /scheduler/tasks               — créer une tâche
  GET    /scheduler/tasks/{id}          — détail
  PUT    /scheduler/tasks/{id}          — modifier
  DELETE /scheduler/tasks/{id}          — supprimer
  POST   /scheduler/tasks/{id}/run-now  — déclencher immédiatement

  GET    /scheduler/outputs             — file d'approbation
  GET    /scheduler/outputs/{id}        — détail d'un output
  POST   /scheduler/outputs/{id}/approve — approuver
  POST   /scheduler/outputs/{id}/reject  — rejeter
"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import verify_secret
from database import (
    create_scheduled_task,
    get_scheduled_task,
    list_scheduled_tasks,
    update_scheduled_task,
    delete_scheduled_task,
    create_autonomous_output,
    get_autonomous_output,
    list_autonomous_outputs,
    update_autonomous_output_status,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["scheduler"])

ALLOWED_TASK_TYPES = {"mission", "veille", "mission_proposals"}
ALLOWED_SCHEDULE_TYPES = {"interval", "cron"}
ALLOWED_OUTPUT_TYPES = {"draft", "article", "comment", "veille_summary", "mission_proposal"}


# ── Pydantic models ────────────────────────────────────────────────────────────

class ScheduledTaskCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    task_type: str = "mission"
    agent: str = "coordinateur"
    mission_template: str = ""
    params: dict = Field(default_factory=dict)
    schedule_type: str = "interval"
    schedule_config: dict = Field(default_factory=lambda: {"hours": 24})
    enabled: bool = True
    requires_approval: bool = True
    budget_tokens_per_run: int = Field(default=50000, ge=1000, le=2_000_000)
    budget_runs_per_day: int = Field(default=3, ge=1, le=48)


class ScheduledTaskUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    task_type: str | None = None
    agent: str | None = None
    mission_template: str | None = None
    params: dict | None = None
    schedule_type: str | None = None
    schedule_config: dict | None = None
    enabled: bool | None = None
    requires_approval: bool | None = None
    budget_tokens_per_run: int | None = Field(default=None, ge=1000, le=2_000_000)
    budget_runs_per_day: int | None = Field(default=None, ge=1, le=48)


class ApproveOutputPayload(BaseModel):
    publish_immediately: bool = False


class RejectOutputPayload(BaseModel):
    reason: str = ""


# ── Task routes ────────────────────────────────────────────────────────────────

@router.get("/scheduler/tasks", dependencies=[Depends(verify_secret)])
async def scheduler_list_tasks():
    tasks = list_scheduled_tasks()
    return {"tasks": tasks, "total": len(tasks)}


@router.get("/scheduler/tasks/{task_id}", dependencies=[Depends(verify_secret)])
async def scheduler_get_task(task_id: str):
    task = get_scheduled_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable")
    return task


@router.post("/scheduler/tasks", dependencies=[Depends(verify_secret)])
async def scheduler_create_task(body: ScheduledTaskCreate):
    if body.task_type not in ALLOWED_TASK_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"task_type invalide — valeurs acceptées : {sorted(ALLOWED_TASK_TYPES)}",
        )
    if body.schedule_type not in ALLOWED_SCHEDULE_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"schedule_type invalide — valeurs acceptées : {sorted(ALLOWED_SCHEDULE_TYPES)}",
        )
    task = create_scheduled_task(
        name=body.name,
        description=body.description,
        task_type=body.task_type,
        agent=body.agent,
        mission_template=body.mission_template,
        params=body.params,
        schedule_type=body.schedule_type,
        schedule_config=body.schedule_config,
        enabled=body.enabled,
        requires_approval=body.requires_approval,
        budget_tokens_per_run=body.budget_tokens_per_run,
        budget_runs_per_day=body.budget_runs_per_day,
    )
    if body.enabled:
        _sync_to_scheduler(task)
    return task


@router.put("/scheduler/tasks/{task_id}", dependencies=[Depends(verify_secret)])
async def scheduler_update_task(task_id: str, body: ScheduledTaskUpdate):
    existing = get_scheduled_task(task_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Tâche introuvable")
    if body.task_type is not None and body.task_type not in ALLOWED_TASK_TYPES:
        raise HTTPException(status_code=422, detail=f"task_type invalide — valeurs acceptées : {sorted(ALLOWED_TASK_TYPES)}")
    if body.schedule_type is not None and body.schedule_type not in ALLOWED_SCHEDULE_TYPES:
        raise HTTPException(status_code=422, detail=f"schedule_type invalide — valeurs acceptées : {sorted(ALLOWED_SCHEDULE_TYPES)}")
    updated = update_scheduled_task(
        task_id,
        name=body.name,
        description=body.description,
        task_type=body.task_type,
        agent=body.agent,
        mission_template=body.mission_template,
        params=body.params,
        schedule_type=body.schedule_type,
        schedule_config=body.schedule_config,
        enabled=body.enabled,
        requires_approval=body.requires_approval,
        budget_tokens_per_run=body.budget_tokens_per_run,
        budget_runs_per_day=body.budget_runs_per_day,
    )
    _sync_to_scheduler(updated)
    return updated


@router.delete("/scheduler/tasks/{task_id}", dependencies=[Depends(verify_secret)])
async def scheduler_delete_task(task_id: str):
    existing = get_scheduled_task(task_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Tâche introuvable")
    from scheduler import get_scheduler, unregister_task
    unregister_task(get_scheduler(), task_id)
    delete_scheduled_task(task_id)
    return {"deleted": task_id}


@router.post("/scheduler/tasks/{task_id}/run-now", dependencies=[Depends(verify_secret)])
async def scheduler_run_now(task_id: str):
    """Déclenche immédiatement une tâche, indépendamment de son planning."""
    from scheduler import run_task_by_id
    import asyncio
    asyncio.create_task(run_task_by_id(task_id))
    return {"triggered": task_id}


# ── Output / approval routes ───────────────────────────────────────────────────

@router.get("/scheduler/outputs", dependencies=[Depends(verify_secret)])
async def scheduler_list_outputs(
    status: str | None = None,
    task_id: str | None = None,
    output_type: str | None = None,
    limit: int = 50,
):
    outputs = list_autonomous_outputs(
        status=status,
        task_id=task_id,
        output_type=output_type,
        limit=min(limit, 200),
    )
    return {"outputs": outputs, "total": len(outputs)}


@router.get("/scheduler/outputs/{output_id}", dependencies=[Depends(verify_secret)])
async def scheduler_get_output(output_id: str):
    output = get_autonomous_output(output_id)
    if not output:
        raise HTTPException(status_code=404, detail="Output introuvable")
    return output


@router.post("/scheduler/outputs/{output_id}/approve", dependencies=[Depends(verify_secret)])
async def scheduler_approve_output(output_id: str, body: ApproveOutputPayload):
    output = get_autonomous_output(output_id)
    if not output:
        raise HTTPException(status_code=404, detail="Output introuvable")
    if output["status"] not in ("pending",):
        raise HTTPException(status_code=409, detail=f"Output déjà traité (status={output['status']})")

    from datetime import datetime
    now_iso = datetime.utcnow().isoformat()

    # Cas spécial : mission_proposal → lancer la mission directement
    if output["output_type"] == "mission_proposal":
        await _approve_mission_proposal(output)
        updated = update_autonomous_output_status(output_id, "approved", approved_at=now_iso, published_at=now_iso)
        return updated

    # Cas général : marquer approuvé, publier si demandé
    updated = update_autonomous_output_status(output_id, "approved", approved_at=now_iso)

    if body.publish_immediately and output.get("target_platform") in ("facebook", "instagram"):
        try:
            from services.social import publish_comment_reply
            await publish_comment_reply(
                platform=output["target_platform"],
                target_ref=output["target_ref"],
                content=output["content"],
            )
            updated = update_autonomous_output_status(output_id, "published", published_at=datetime.utcnow().isoformat())
        except Exception as exc:
            logger.error("Erreur publication Meta pour output %s : %s", output_id, exc)
            raise HTTPException(status_code=502, detail=f"Approbation enregistrée mais publication échouée : {exc}")

    return updated


@router.post("/scheduler/outputs/{output_id}/reject", dependencies=[Depends(verify_secret)])
async def scheduler_reject_output(output_id: str, body: RejectOutputPayload):
    output = get_autonomous_output(output_id)
    if not output:
        raise HTTPException(status_code=404, detail="Output introuvable")
    if output["status"] not in ("pending",):
        raise HTTPException(status_code=409, detail=f"Output déjà traité (status={output['status']})")
    updated = update_autonomous_output_status(output_id, "rejected", rejection_reason=body.reason)
    return updated


# ── Helpers ────────────────────────────────────────────────────────────────────

def _sync_to_scheduler(task: dict | None) -> None:
    """Synchronise l'état enabled/disabled d'une tâche avec le scheduler runtime."""
    if not task:
        return
    from scheduler import get_scheduler, _register_task, unregister_task
    sched = get_scheduler()
    if task.get("enabled"):
        _register_task(sched, task)
    else:
        unregister_task(sched, task["id"])


async def _approve_mission_proposal(output: dict) -> None:
    """Convertit un output mission_proposal en job réel."""
    import asyncio
    import uuid
    from services.mission import _schedule_mission_execution, _mission_config_from_payload

    job_id = str(uuid.uuid4())[:8]
    mission_text = output.get("content") or output.get("title") or "Mission proposée par l'agent"

    from scheduler import _CaptureBT
    bt = _CaptureBT()
    cfg = _mission_config_from_payload({
        "require_user_validation": True,
        "mode": "cio",
        "cio_plan_hitl_enabled": False,
    })
    _schedule_mission_execution(bt, job_id, "coordinateur", mission_text, None, "mission_proposal", mission_config=cfg)

    loop = asyncio.get_event_loop()
    for func, args, kwargs in bt._tasks:
        loop.run_in_executor(None, lambda f=func, a=args, k=kwargs: f(*a, **k))

    logger.info("Mission proposal %r → job %s lancé", output["id"], job_id)
