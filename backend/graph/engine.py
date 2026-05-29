"""Sélection moteur orchestration : legacy | langgraph | shadow."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_ENGINES = frozenset({"legacy", "langgraph", "shadow"})


def get_orchestration_engine() -> str:
    try:
        from database import get_behavior_setting
        from services.behavior_defaults import behavior_default_value

        raw = get_behavior_setting("orchestration.engine")
        if raw is None:
            raw = behavior_default_value("orchestration.engine")
        engine = str(raw or "legacy").strip().lower()
        if engine not in _ENGINES:
            return "legacy"
        return engine
    except Exception:
        return "legacy"


def use_langgraph_execution() -> bool:
    return get_orchestration_engine() in {"langgraph", "shadow"}


def is_shadow_mode() -> bool:
    return get_orchestration_engine() == "shadow"
