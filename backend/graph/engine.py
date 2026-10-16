"""Sélection moteur : langgraph (second cerveau) | legacy | shadow."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_ENGINES = frozenset({"legacy", "langgraph", "shadow"})


def langgraph_allowed() -> bool:
    """Le second cerveau est le chemin normal tant que l'application n'est pas lancée aux clients."""
    return True


def get_orchestration_engine() -> str:
    try:
        from database import get_behavior_setting
        from services.behavior_defaults import behavior_default_value

        raw = get_behavior_setting("orchestration.engine")
        if raw is None:
            raw = behavior_default_value("orchestration.engine")
        engine = str(raw or "langgraph").strip().lower()
        if engine not in _ENGINES:
            return "langgraph"
        return engine
    except Exception:
        logger.exception("lecture du moteur d'orchestration")
        return "langgraph"


def use_langgraph_execution() -> bool:
    return get_orchestration_engine() in {"langgraph", "shadow"}


def is_shadow_mode() -> bool:
    return get_orchestration_engine() == "shadow"
