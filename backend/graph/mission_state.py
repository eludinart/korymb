"""État partagé du graphe mission LangGraph."""
from __future__ import annotations

from typing import Any, TypedDict


class MissionGraphState(TypedDict, total=False):
    job_id: str
    agent_key: str
    mission_plain: str
    context: dict[str, Any] | None
    source_tag: str
    mission_config: dict[str, Any]
    phase: str
    mode: str
    result: str
    tokens_in: int
    tokens_out: int
    error: str
    hitl_resolution: dict[str, Any] | None
    behavior_snapshot: dict[str, Any]
    completed_agents: list[str]
    plan_json: dict[str, Any]
