"""HITL via interrupt LangGraph (remplace poll loop en mode langgraph)."""
from __future__ import annotations

import logging
from typing import Any

from database import get_job as db_get_job
from graph.engine import use_langgraph_execution
from state import KorymbJobCancelled, raise_if_job_cancelled as _raise_if_job_cancelled

logger = logging.getLogger(__name__)


def wait_hitl_or_poll(job_id: str, job_logs: list | None) -> dict[str, Any]:
    """Mode langgraph : interrupt ; sinon délègue au poll legacy."""
    if use_langgraph_execution():
        return _interrupt_hitl(job_id, job_logs)
    from services.mission import _wait_for_cio_plan_hitl_resolution_legacy_poll

    return _wait_for_cio_plan_hitl_resolution_legacy_poll(job_id, job_logs)


def _interrupt_hitl(job_id: str, job_logs: list | None) -> dict[str, Any]:
    from langgraph.types import interrupt

    _raise_if_job_cancelled(job_id)
    row = db_get_job(job_id)
    gate = (row or {}).get("hitl_gate") or {}
    if job_logs is not None:
        job_logs.append("[korymb] HITL plan CIO — pause LangGraph (interrupt).")
    payload = interrupt({"kind": "cio_plan", "job_id": job_id, "gate": gate})
    if not isinstance(payload, dict):
        payload = {"decision": "approve"}
    decision = str(payload.get("decision") or "approve").strip().lower()
    if decision == "reject":
        if job_logs is not None:
            job_logs.append("[korymb] Plan CIO — rejet dirigeant (HITL).")
        raise KorymbJobCancelled()
    return payload
