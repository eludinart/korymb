"""Exécution et reprise des missions via LangGraph."""
from __future__ import annotations

import logging
from typing import Any

from langgraph.types import Command

from graph.engine import is_shadow_mode, use_langgraph_execution
from graph.mission_graph import build_mission_graph
from graph.mission_state import MissionGraphState

logger = logging.getLogger(__name__)


def _thread_config(job_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": job_id}}


def run_mission_graph(
    *,
    job_id: str,
    agent_key: str,
    mission_plain: str,
    context: dict | None,
    source_tag: str,
    mission_config: dict,
    behavior_snapshot: dict | None = None,
) -> dict[str, Any] | None:
    """Exécute le graphe. Retourne l'état final ou None si shadow-only."""
    if not use_langgraph_execution():
        return None

    initial: MissionGraphState = {
        "job_id": job_id,
        "agent_key": agent_key,
        "mission_plain": mission_plain,
        "context": context,
        "source_tag": source_tag,
        "mission_config": mission_config,
        "behavior_snapshot": behavior_snapshot or {},
        "phase": "pending",
        "tokens_in": 0,
        "tokens_out": 0,
    }

    try:
        from database import update_job_checkpoint_thread

        update_job_checkpoint_thread(job_id, job_id)
    except Exception:
        pass

    graph = build_mission_graph()
    if is_shadow_mode():
        logger.info("[shadow] LangGraph dry-run log for job %s", job_id)
        return None

    final = graph.invoke(initial, _thread_config(job_id))
    return final


def resume_mission_graph(job_id: str, hitl_payload: dict[str, Any]) -> dict[str, Any]:
    graph = build_mission_graph()
    return graph.invoke(Command(resume=hitl_payload), _thread_config(job_id))


def get_graph_state(job_id: str) -> dict[str, Any] | None:
    graph = build_mission_graph()
    snap = graph.get_state(_thread_config(job_id))
    if snap is None:
        return None
    return {
        "values": snap.values,
        "next": snap.next,
        "tasks": snap.tasks,
    }
