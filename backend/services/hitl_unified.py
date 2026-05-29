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
    if not result.get("success") or not langgraph_resume:
        return result
    try:
        from graph.engine import use_langgraph_execution
        from graph.runner import resume_mission_graph

        if use_langgraph_execution():
            dec = decision or ("approve" if approved is not False else "reject")
            payload = {"decision": dec, "amended_plan": amended_plan}
            resume_mission_graph(job_id, payload)
    except Exception as exc:
        logger.warning("LangGraph resume after HITL failed for %s: %s", job_id, exc)
    return result
