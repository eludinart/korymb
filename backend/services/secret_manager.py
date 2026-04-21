"""
services/secret_manager.py — Accès centralisé aux secrets sans exposition dans les logs ni les prompts.

Wraps runtime_settings.merge_with_env() pour fournir une interface stable.
Les valeurs retournées ne doivent JAMAIS être interpolées dans des chaînes de logs ou des prompts LLM.

Usage :
    from services.secret_manager import get_secret, assert_secret_present
    key = get_secret("anthropic_api_key")
"""
from __future__ import annotations

import logging
from typing import Any

from runtime_settings import merge_with_env

logger = logging.getLogger(__name__)

# Clés sensibles : leur valeur ne doit jamais apparaître en clair dans les logs.
_SENSITIVE_KEYS: frozenset[str] = frozenset({
    "anthropic_api_key",
    "openrouter_api_key",
    "agent_api_secret",
    "fleur_db_password",
    "korymb_db_password",
})


def get_secret(key: str, default: Any = None) -> Any:
    """
    Retourne la valeur d'un secret depuis les sources de config (env + runtime overrides).
    Ne logue jamais la valeur, seulement la présence/absence.
    """
    cfg = merge_with_env()
    value = cfg.get(key, default)
    if value is None or (isinstance(value, str) and not value.strip()):
        logger.debug("SecretManager: clé '%s' absente ou vide.", key)
        return default
    return value


def assert_secret_present(key: str, hint: str = "") -> str:
    """
    Lève RuntimeError si la clé est absente. Retourne la valeur (str).
    Utilisé aux points d'entrée LLM pour fail-fast proprement.
    """
    value = get_secret(key)
    if not value or (isinstance(value, str) and not str(value).strip()):
        msg = f"Secret requis '{key}' manquant."
        if hint:
            msg += f" {hint}"
        raise RuntimeError(msg)
    return str(value)


def get_llm_provider() -> str:
    """Retourne le fournisseur LLM effectif ('anthropic' | 'openrouter')."""
    return str(get_secret("llm_provider") or "anthropic")


def mask_secret(value: str | None, visible_chars: int = 4) -> str:
    """Masque une valeur sensible pour l'affichage (logs, UI). Ex : 'sk-an...**'."""
    if not value:
        return "(vide)"
    s = str(value)
    if len(s) <= visible_chars:
        return "*" * len(s)
    return s[:visible_chars] + "…*"
