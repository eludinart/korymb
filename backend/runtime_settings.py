"""
Surcharges LLM persistées (JSON) — fusionnées avec les variables d'environnement.
Fichier : backend/data/runtime_settings.json (déjà ignoré par git via backend/data/).
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

_KEYS = frozenset({
    "llm_provider",
    "anthropic_api_key",
    "anthropic_model",
    "anthropic_models",
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


def _read_disk_raw() -> dict[str, Any]:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PATH.exists():
        return {}
    try:
        with open(PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def merge_with_env() -> dict[str, Any]:
    """Valeurs effectives : fichier runtime > .env (pydantic settings)."""
    disk = _read_disk_raw()
    out: dict[str, Any] = {
        "llm_provider": settings.llm_provider,
        "anthropic_api_key": settings.anthropic_api_key,
        "anthropic_model": settings.anthropic_model,
        "anthropic_models": settings.anthropic_models,
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
    for k, v in disk.items():
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

    # Ancien fournisseur LLM « google » (AI Studio direct) : bascule OpenRouter.
    if str(out.get("llm_provider") or "").strip().lower() == "google":
        out["llm_provider"] = "openrouter"
    return out


def save_partial(updates: dict[str, Any]) -> dict[str, Any]:
    """Fusionne `updates` dans le JSON. Clés API : seulement si une valeur non vide est fournie."""
    current = {k: v for k, v in _read_disk_raw().items() if k in _KEYS}
    for k, v in updates.items():
        if k not in _KEYS:
            continue
        if k in ("anthropic_api_key", "openrouter_api_key"):
            if isinstance(v, str) and v.strip():
                current[k] = v.strip()
            continue
        if v is None:
            continue
        if isinstance(v, str) and (not v.strip()) and k == "llm_provider":
            continue
        if isinstance(v, str) and (not v.strip()) and k in (
            "anthropic_model", "anthropic_models",
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
    PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(current, ensure_ascii=False, indent=2)
    with _WRITE_LOCK:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=str(PATH.parent)) as tmp:
            tmp.write(payload)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = tmp.name
        os.replace(tmp_path, PATH)
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
