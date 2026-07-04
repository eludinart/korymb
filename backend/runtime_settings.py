"""
Surcharges LLM persistées — fusionnées avec les variables d'environnement.

Stockage principal : table `llm_runtime_settings` (SQLite dev / MariaDB prod).
Migration automatique depuis l'ancien fichier `backend/data/runtime_settings.json`.
"""
from __future__ import annotations

import json
import os
import tempfile
from threading import Lock
from pathlib import Path
from typing import Any

from config import settings

PATH = Path(__file__).parent / "data" / "runtime_settings.json"
_WRITE_LOCK = Lock()
_MIGRATED_FROM_FILE = False

_KEYS = frozenset({
    "llm_provider",
    "anthropic_api_key",
    "anthropic_model",
    "anthropic_models",
    "mistral_api_key",
    "mistral_model",
    "mistral_models",
    "mistral_base_url",
    "openrouter_api_key",
    "openrouter_model",
    "openrouter_models",
    "openrouter_base_url",
    "openrouter_http_referer",
    "openrouter_app_title",
    "llm_price_input_per_million_usd",
    "llm_price_output_per_million_usd",
    "llm_tiers_json",
    "token_alert_threshold",
    "daily_budget_usd",
})


def _read_json_file_raw() -> dict[str, Any]:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PATH.exists():
        return {}
    try:
        with open(PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _migrate_json_file_to_db(file_data: dict[str, Any]) -> None:
    global _MIGRATED_FROM_FILE
    if _MIGRATED_FROM_FILE or not file_data:
        return
    try:
        from database import save_llm_runtime_settings_raw

        save_llm_runtime_settings_raw({k: v for k, v in file_data.items() if k in _KEYS})
        _MIGRATED_FROM_FILE = True
    except Exception:
        pass


def _read_disk_raw() -> dict[str, Any]:
    """Surcharges persistées : base de données, avec repli fichier legacy."""
    try:
        from database import load_llm_runtime_settings_raw

        db_data = load_llm_runtime_settings_raw()
        if db_data:
            return {k: v for k, v in db_data.items() if k in _KEYS}
    except Exception:
        pass

    file_data = _read_json_file_raw()
    if file_data:
        _migrate_json_file_to_db(file_data)
        try:
            from database import load_llm_runtime_settings_raw

            db_data = load_llm_runtime_settings_raw()
            if db_data:
                return {k: v for k, v in db_data.items() if k in _KEYS}
        except Exception:
            pass
        return {k: v for k, v in file_data.items() if k in _KEYS}
    return {}


def _apply_persisted_overrides(out: dict[str, Any], persisted: dict[str, Any]) -> dict[str, Any]:
    for k, v in persisted.items():
        if k not in _KEYS:
            continue
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if k in ("llm_price_input_per_million_usd", "llm_price_output_per_million_usd", "daily_budget_usd"):
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                continue
            continue
        if k == "token_alert_threshold":
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                continue
            continue
        if k == "llm_tiers_json":
            out[k] = str(v).strip() if v is not None else ""
            continue
        out[k] = v
    return out


def merge_with_env() -> dict[str, Any]:
    """Valeurs effectives : surcharges persistées (base) > .env (pydantic settings)."""
    persisted = _read_disk_raw()
    out: dict[str, Any] = {
        "llm_provider": settings.llm_provider,
        "anthropic_api_key": settings.anthropic_api_key,
        "anthropic_model": settings.anthropic_model,
        "anthropic_models": settings.anthropic_models,
        "mistral_api_key": settings.mistral_api_key,
        "mistral_model": settings.mistral_model,
        "mistral_models": settings.mistral_models,
        "mistral_base_url": settings.mistral_base_url,
        "openrouter_api_key": settings.openrouter_api_key,
        "openrouter_model": settings.openrouter_model,
        "openrouter_models": settings.openrouter_models,
        "openrouter_base_url": settings.openrouter_base_url,
        "openrouter_http_referer": settings.openrouter_http_referer,
        "openrouter_app_title": settings.openrouter_app_title,
        "llm_price_input_per_million_usd": settings.llm_price_input_per_million_usd,
        "llm_price_output_per_million_usd": settings.llm_price_output_per_million_usd,
        "llm_tiers_json": "",
        "token_alert_threshold": settings.token_alert_threshold,
        "daily_budget_usd": 0.0,
    }
    _apply_persisted_overrides(out, persisted)

    # Ancien fournisseur LLM « google » (AI Studio direct) : bascule OpenRouter.
    if str(out.get("llm_provider") or "").strip().lower() == "google":
        out["llm_provider"] = "openrouter"
    return out


def _merge_updates(current: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    for k, v in updates.items():
        if k not in _KEYS:
            continue
        if k in ("anthropic_api_key", "openrouter_api_key", "mistral_api_key"):
            if isinstance(v, str) and v.strip():
                current[k] = v.strip()
            continue
        if v is None:
            continue
        if isinstance(v, str) and (not v.strip()) and k == "llm_provider":
            continue
        if isinstance(v, str) and (not v.strip()) and k in (
            "anthropic_model", "anthropic_models",
            "mistral_model", "mistral_models", "mistral_base_url",
            "openrouter_model", "openrouter_models", "openrouter_base_url",
        ):
            continue
        if k in ("openrouter_http_referer", "openrouter_app_title"):
            current[k] = str(v) if v is not None else ""
            continue
        if k in ("llm_price_input_per_million_usd", "llm_price_output_per_million_usd", "daily_budget_usd"):
            try:
                current[k] = float(v)
            except (TypeError, ValueError):
                continue
            continue
        if k == "token_alert_threshold":
            try:
                current[k] = int(v)
            except (TypeError, ValueError):
                continue
            continue
        if k == "llm_tiers_json":
            from llm_tiers import validate_llm_tiers_json

            raw = str(v).strip() if v is not None else ""
            ok, err = validate_llm_tiers_json(raw)
            if not ok:
                raise ValueError(err)
            current[k] = raw
            continue
        if isinstance(v, str):
            current[k] = v
        else:
            current[k] = v
    return current


def save_partial(updates: dict[str, Any]) -> dict[str, Any]:
    """Fusionne `updates` dans la config persistée. Clés API : seulement si valeur non vide."""
    current = {k: v for k, v in _read_disk_raw().items() if k in _KEYS}
    current = _merge_updates(current, updates)
    with _WRITE_LOCK:
        from database import save_llm_runtime_settings_raw

        save_llm_runtime_settings_raw(current)
    return merge_with_env()


def to_public_dict(merged: dict[str, Any]) -> dict[str, Any]:
    """Pour GET admin / UI : pas d'exfiltration des clés complètes."""
    out: dict[str, Any] = {}
    for k in _KEYS:
        v = merged.get(k)
        if "api_key" in k:
            s = str(v or "")
            out[k] = ""
            out[f"{k}_set"] = bool(s.strip())
        else:
            out[k] = v
    try:
        from llm_tiers import tier_config_public

        out["tier_routing"] = tier_config_public(merged)
    except Exception:
        out["tier_routing"] = {}
    return out
