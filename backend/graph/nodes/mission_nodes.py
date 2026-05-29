"""Nœuds LangGraph — délégation vers le moteur mission existant."""
from __future__ import annotations

import logging
from typing import Any

from graph.mission_state import MissionGraphState
from state import active_jobs, emit_job_event

logger = logging.getLogger(__name__)


def _set_phase(job_id: str | None, phase: str) -> None:
    if not job_id:
        return
    try:
        from database import update_job_orchestration_phase

        update_job_orchestration_phase(job_id, phase)
    except Exception:
        logger.debug("phase update skipped for %s", job_id)
    emit_job_event(job_id, "phase_transition", "coordinateur", {"phase": phase})


def node_init(state: MissionGraphState) -> dict[str, Any]:
    job_id = state.get("job_id") or ""
    cfg = state.get("mission_config") or {}
    mode = str(cfg.get("mode") or "cio")
    _set_phase(job_id, "init")
    return {"phase": "init", "mode": mode}


def node_run_cio(state: MissionGraphState) -> dict[str, Any]:
    from services.mission import orchestrate_coordinateur_mission

    job_id = state["job_id"]
    job_logs: list[str] = []
    if job_id in active_jobs:
        job_logs = active_jobs[job_id].setdefault("logs", [])
    cfg = state.get("mission_config") or {}
    _set_phase(job_id, "plan")
    mission_txt = state.get("mission_plain") or ""
    ctx = state.get("context")
    if ctx:
        import json

        mission_txt = f"{mission_txt}\n\nContexte : {json.dumps(ctx, ensure_ascii=False)}"

    result, ti, to = orchestrate_coordinateur_mission(
        mission_txt,
        state.get("mission_plain") or "",
        job_logs,
        chat_mode=False,
        job_id=job_id,
        cio_questions_enabled=bool(cfg.get("cio_questions_enabled", True)),
        cio_plan_hitl_enabled=bool(cfg.get("cio_plan_hitl_enabled", False)),
    )
    _set_phase(job_id, "completed")
    return {"result": result, "tokens_in": ti, "tokens_out": to, "phase": "completed"}


def node_run_triad(state: MissionGraphState) -> dict[str, Any]:
    from services.knowledge import build_entity_context_block
    from services.triad_orchestrator import orchestrate_triad

    job_id = state["job_id"]
    job_logs: list[str] = active_jobs.get(job_id, {}).setdefault("logs", [])
    _set_phase(job_id, "triad")
    mission = state.get("mission_plain") or ""

    def emit(typ: str, agent: str | None, payload: dict):
        emit_job_event(job_id, typ, agent, payload)

    entity_ctx = build_entity_context_block(mission)
    result, ti, to = orchestrate_triad(
        mission=mission,
        entity_context=entity_ctx,
        emit=emit,
        usage_job_id=job_id,
    )
    _set_phase(job_id, "completed")
    return {"result": result, "tokens_in": ti, "tokens_out": to, "phase": "completed"}


def node_run_single(state: MissionGraphState) -> dict[str, Any]:
    from agent_tool_use import llm_turn_maybe_tools
    from services.agents import agents_def, FLEUR_CONTEXT, SUB_AGENT_COORDINATION_FR
    from services.mission import _korymb_memory_prompt_for

    job_id = state["job_id"]
    agent_key = state.get("agent_key") or "coordinateur"
    agent_cfg = agents_def().get(agent_key, agents_def()["coordinateur"])
    job_logs: list[str] = active_jobs.get(job_id, {}).setdefault("logs", [])
    _set_phase(job_id, "single")
    mem = _korymb_memory_prompt_for(agent_key, exclude_job_id=job_id)
    sub = SUB_AGENT_COORDINATION_FR if agent_key != "coordinateur" else ""
    system = agent_cfg["system"] + FLEUR_CONTEXT + mem + sub
    mission = state.get("mission_plain") or ""
    result, ti, to = llm_turn_maybe_tools(
        system,
        mission,
        agent_key=agent_key,
        usage_job_id=job_id,
        usage_context="single_agent",
    )
    _set_phase(job_id, "completed")
    return {"result": result, "tokens_in": ti, "tokens_out": to, "phase": "completed"}


def route_by_mode(state: MissionGraphState) -> str:
    mode = str(state.get("mode") or "cio")
    agent_key = str(state.get("agent_key") or "coordinateur")
    if mode == "triad":
        return "triad"
    if mode == "single" or agent_key != "coordinateur":
        return "single"
    return "cio"
