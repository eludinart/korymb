"""Résolution HITL unifiée (jobs + missions routes)."""
from __future__ import annotations

import logging
from typing import Any

from services.orchestrator import resume_hitl_gate

logger = logging.getLogger(__name__)


def resolve_hitl(
    job_id: str,
    *,
    approved: bool | None = None,
    comment: str = "",
    decision: str | None = None,
    amended_plan: dict | None = None,
    feedback: str = "",
    langgraph_resume: bool = True,
) -> dict[str, Any]:
    result = resume_hitl_gate(
        job_id=job_id,
        approved=approved,
        comment=comment,
        decision=decision,
        amended_plan=amended_plan,
        feedback=feedback,
    )
    inline_waiter = False
    try:
        from services.hitl_wait import has_hitl_waiter

        inline_waiter = has_hitl_waiter(str(job_id))
    except Exception:
        logger.debug("HITL waiter probe failed for %s", job_id)
    try:
        from services.hitl_wait import notify_hitl_resolved

        notify_hitl_resolved(job_id)
    except Exception as exc:
        logger.debug("HITL wait notify skipped for %s: %s", job_id, exc)
    if not result.get("success"):
        return _attach_cio_chain(result, orphan_scheduled=False, inline_waiter=inline_waiter)
    dec = str(result.get("decision") or decision or "").strip().lower()
    orphan_scheduled = False
    if langgraph_resume:
        try:
            from graph.engine import use_langgraph_execution
            from graph.runner import resume_mission_graph

            if use_langgraph_execution():
                payload = {"decision": dec or ("approve" if approved is not False else "reject"), "amended_plan": amended_plan}
                resume_mission_graph(job_id, payload)
                inline_waiter = True
        except Exception as exc:
            logger.warning("LangGraph resume after HITL failed for %s: %s", job_id, exc)
    if result.get("success") and dec in ("approve", "amend") and not inline_waiter:
        try:
            from tenant_context import spawn_thread
            from services.mission import resume_orphan_hitl_execution

            resume_id = str(result.get("job_id") or job_id)
            spawn_thread(
                lambda rid=resume_id: resume_orphan_hitl_execution(rid),
                name=f"hitl-resume-{resume_id[:8]}",
            )
            orphan_scheduled = True
        except Exception:
            logger.exception("HITL orphan resume schedule failed for %s", job_id)
    return _attach_cio_chain(result, orphan_scheduled=orphan_scheduled, inline_waiter=inline_waiter)


def _attach_cio_chain(
    result: dict[str, Any],
    *,
    orphan_scheduled: bool = False,
    inline_waiter: bool = False,
) -> dict[str, Any]:
    """Ajoute un récap chaîne pour l'inbox (valider + lancer)."""
    if not result.get("success"):
        return result
    dec = str(result.get("decision") or "").strip().lower()
    if dec == "reject":
        result["chain"] = {
            "launched": False,
            "steps": ["Plan CIO rejeté — mission annulée"],
            "new_status": result.get("new_status"),
        }
        return result
    if dec not in ("approve", "amend"):
        return result
    if orphan_scheduled:
        follow = "Mission relancée — exécution reprise après validation"
    elif inline_waiter:
        follow = "Mission relancée — les sous-agents démarrent"
    else:
        follow = "Validation enregistrée — reprise non lancée"
    lead = "Plan CIO amendé et validé" if dec == "amend" else "Plan CIO validé"
    result["chain"] = {
        "launched": bool(orphan_scheduled or inline_waiter),
        "steps": [lead, follow],
        "new_status": result.get("new_status") or "running",
        "job_id": result.get("job_id"),
    }
    return result
