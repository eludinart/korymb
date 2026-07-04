"""
Surcharges intégrations persistées — fusionnées avec os.environ (.env).

Priorité : runtime DB (admin UI) > variables d'environnement / .env
"""
from __future__ import annotations

import os
import time
from threading import Lock
from typing import Any

from integration_catalog import INTEGRATION_GROUPS, INTEGRATION_KEYS

_WRITE_LOCK = Lock()
_PERSISTED_CACHE: dict[str, Any] | None = None
_PERSISTED_CACHE_AT = 0.0
_PERSISTED_CACHE_TTL_SEC = 2.0

_LLM_ENV_FALLBACK: dict[str, str] = {
    "ANTHROPIC_API_KEY": "anthropic_api_key",
    "OPENROUTER_API_KEY": "openrouter_api_key",
    "OPENROUTER_BASE_URL": "openrouter_base_url",
    "OPENROUTER_HTTP_REFERER": "openrouter_http_referer",
    "OPENROUTER_APP_TITLE": "openrouter_app_title",
}

_SECRET_FIELDS: dict[str, bool] = {
    field["key"]: bool(field.get("secret"))
    for group in INTEGRATION_GROUPS
    for field in group["fields"]
}


def _invalidate_persisted_cache() -> None:
    global _PERSISTED_CACHE, _PERSISTED_CACHE_AT
    _PERSISTED_CACHE = None
    _PERSISTED_CACHE_AT = 0.0


def _read_persisted(*, force: bool = False) -> dict[str, Any]:
    """Charge les surcharges runtime (une requête DB, cache court en mémoire)."""
    global _PERSISTED_CACHE, _PERSISTED_CACHE_AT
    now = time.monotonic()
    if (
        not force
        and _PERSISTED_CACHE is not None
        and (now - _PERSISTED_CACHE_AT) < _PERSISTED_CACHE_TTL_SEC
    ):
        return _PERSISTED_CACHE
    try:
        from database import load_integration_settings_raw

        raw = load_integration_settings_raw()
        data = {k: v for k, v in raw.items() if k in INTEGRATION_KEYS}
    except Exception:
        data = {}
    _PERSISTED_CACHE = data
    _PERSISTED_CACHE_AT = now
    return data


def _llm_runtime_values() -> dict[str, Any]:
    try:
        from runtime_settings import merge_with_env

        return merge_with_env()
    except Exception:
        return {}


def _resolve_value(
    key: str,
    *,
    persisted: dict[str, Any] | None = None,
    llm_runtime: dict[str, Any] | None = None,
    default: str = "",
) -> str:
    name = (key or "").strip()
    if not name:
        return default
    store = persisted if persisted is not None else _read_persisted()
    if name in store:
        val = store[name]
        if val is not None and str(val).strip():
            return str(val).strip()
    env_val = str(os.getenv(name, default) or "").strip()
    if env_val:
        return env_val
    llm_key = _LLM_ENV_FALLBACK.get(name)
    if llm_key:
        runtime = llm_runtime if llm_runtime is not None else _llm_runtime_values()
        return str(runtime.get(llm_key) or "").strip()
    return default


def getenv(name: str, default: str = "") -> str:
    """Valeur effective d'une clé d'intégration (runtime > .env)."""
    return _resolve_value(name, default=default)


def is_set(name: str) -> bool:
    return bool(getenv(name))


def effective_values() -> dict[str, str]:
    """Toutes les clés du catalogue avec valeur effective (pour sondes)."""
    persisted = _read_persisted()
    llm_runtime = _llm_runtime_values()
    out: dict[str, str] = {}
    for key in INTEGRATION_KEYS:
        val = _resolve_value(key, persisted=persisted, llm_runtime=llm_runtime)
        if val:
            out[key] = val
    return out


def _is_secret_field(key: str) -> bool:
    return _SECRET_FIELDS.get(key, True)


def to_public_dict() -> dict[str, Any]:
    """GET admin : valeurs non secrètes + flags *_set + source runtime|env."""
    persisted = _read_persisted()
    llm_runtime = _llm_runtime_values()
    values: dict[str, Any] = {}
    for key in INTEGRATION_KEYS:
        effective = _resolve_value(key, persisted=persisted, llm_runtime=llm_runtime)
        is_secret = _is_secret_field(key)
        set_flag = bool(effective)
        if is_secret:
            values[key] = ""
            values[f"{key}_set"] = set_flag
        else:
            values[key] = effective
            values[f"{key}_set"] = set_flag
        if set_flag:
            if key in persisted and str(persisted.get(key) or "").strip():
                values[f"{key}_source"] = "runtime"
            else:
                values[f"{key}_source"] = "env"
        else:
            values[f"{key}_source"] = "none"
    return values


def save_partial(updates: dict[str, Any], *, clear_fields: list[str] | None = None) -> dict[str, Any]:
    """Fusionne les mises à jour. Secrets vides = pas de changement. clear_fields = effacement explicite."""
    current = _read_persisted(force=True)
    for key in clear_fields or []:
        if key in INTEGRATION_KEYS:
            current.pop(key, None)
    for key, val in updates.items():
        if key not in INTEGRATION_KEYS:
            continue
        if val is None:
            continue
        s = str(val).strip() if val is not None else ""
        if _is_secret_field(key):
            if not s:
                continue
            current[key] = s
        else:
            current[key] = s
    with _WRITE_LOCK:
        from database import save_integration_settings_raw

        save_integration_settings_raw(current)
        _invalidate_persisted_cache()
    return to_public_dict()


def catalog_for_api() -> list[dict[str, Any]]:
    """Catalogue pour l'UI (sans secrets)."""
    return INTEGRATION_GROUPS
