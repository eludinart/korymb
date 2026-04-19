"""
Schéma d'observabilité multi-agent (événements append-only, versionné).

Évolue vers : pagination par curseur, export NDJSON, bus externe — les champs
`v` et `type` restent stables pour les consommateurs UI / analytics.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable

OBS_SCHEMA_VERSION = 1

# Types d'événements connus (extensible ; l'UI ignore les types inconnus).
EVENT_TYPES = frozenset({
    "mission_start",
    "orchestration_start",
    "plan_parsed",
    "delegation",
    "handoff",
    "instruction_delivered",
    "sub_agent_working",
    "agent_turn_start",
    "tool_call",
    "agent_turn_done",
    "synthesis_start",
    "synthesis_done",
    "mission_done",
    "refinement_round",
    "error",
    "team_dialogue",
    "delivery_review",
})

EmitFn = Callable[[str, str | None, dict[str, Any]], None]


def utc_ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def trim_payload(obj: Any, max_chars: int = 4000) -> Any:
    """Réduit la taille d'un payload pour stockage / API (JSON-safe)."""
    try:
        s = json.dumps(obj, ensure_ascii=False)
    except (TypeError, ValueError):
        s = str(obj)
    if len(s) <= max_chars:
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return obj
    return {"_truncated": True, "preview": s[: max_chars - 80] + "…"}


def make_event(
    typ: str,
    agent: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "v": OBS_SCHEMA_VERSION,
        "ts": utc_ts(),
        "type": typ,
        "agent": agent,
        "payload": payload or {},
    }
