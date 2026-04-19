"""
Paliers OpenRouter : plusieurs modèles + tarifs (USD / million de tokens).
Config JSON dans `llm_tiers_json` (runtime_settings / admin).
"""
from __future__ import annotations

import json
import re
from typing import Any

_TIER_ORDER = ("lite", "standard", "heavy")


def _coerce_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def parse_llm_tiers(cfg: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = cfg.get("llm_tiers_json")
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for key, val in data.items():
        if not isinstance(val, dict):
            continue
        k = str(key).strip().lower()[:24]
        if not k:
            continue
        model = str(val.get("model") or "").strip()
        if not model:
            continue
        out[k] = {
            "model": model[:200],
            "price_input_per_million_usd": _coerce_float(val.get("price_input_per_million_usd"), 0.0),
            "price_output_per_million_usd": _coerce_float(val.get("price_output_per_million_usd"), 0.0),
        }
    return out


def resolve_openrouter_tier(
    cfg: dict[str, Any],
    profile: str,
) -> tuple[str, str, float, float]:
    """
    Retourne (model_id, tier_key_used, price_in_per_m, price_out_per_m).
    `profile` : lite | standard | heavy (insensible à la casse).
    """
    prof = (profile or "lite").strip().lower()
    if prof not in _TIER_ORDER:
        prof = "lite"
    tiers = parse_llm_tiers(cfg)
    fallback_model = str(cfg.get("openrouter_model") or "openai/gpt-4o-mini").strip()
    pin = _coerce_float(cfg.get("llm_price_input_per_million_usd"), 0.0)
    pout = _coerce_float(cfg.get("llm_price_output_per_million_usd"), 0.0)

    if prof in tiers:
        t = tiers[prof]
        return (
            t["model"],
            prof,
            float(t["price_input_per_million_usd"] or pin),
            float(t["price_output_per_million_usd"] or pout),
        )
    for alt in _TIER_ORDER:
        if alt in tiers:
            t = tiers[alt]
            return (
                t["model"],
                f"{prof}→{alt}",
                float(t["price_input_per_million_usd"] or pin),
                float(t["price_output_per_million_usd"] or pout),
            )
    return fallback_model, "default", pin, pout


def tier_config_public(cfg: dict[str, Any]) -> dict[str, Any]:
    """Résumé pour l’UI (sans secrets)."""
    tiers = parse_llm_tiers(cfg)
    fb = str(cfg.get("openrouter_model") or "").strip()
    pin = _coerce_float(cfg.get("llm_price_input_per_million_usd"), 0.0)
    pout = _coerce_float(cfg.get("llm_price_output_per_million_usd"), 0.0)
    heavy_pout = 0.0
    if "heavy" in tiers:
        heavy_pout = float(tiers["heavy"].get("price_output_per_million_usd") or 0.0)
    elif tiers:
        first = next(iter(tiers.values()))
        heavy_pout = float(first.get("price_output_per_million_usd") or 0.0)
    else:
        heavy_pout = pout
    lite_pout = pout
    if "lite" in tiers:
        lite_pout = float(tiers["lite"].get("price_output_per_million_usd") or lite_pout)
    expensive_research = heavy_pout >= max(lite_pout * 2.5, 1.0) and heavy_pout > lite_pout + 1e-6
    return {
        "openrouter_fallback_model": fb,
        "tiers": {k: {"model": v["model"], "price_input_per_million_usd": v["price_input_per_million_usd"],
                      "price_output_per_million_usd": v["price_output_per_million_usd"]} for k, v in tiers.items()},
        "expensive_research_tier": bool(expensive_research),
        "default_prices": {"input_per_million_usd": pin, "output_per_million_usd": pout},
    }


def default_llm_tiers_json_example() -> str:
    return json.dumps(
        {
            "lite": {
                "model": "openai/gpt-4o-mini",
                "price_input_per_million_usd": 0.15,
                "price_output_per_million_usd": 0.6,
            },
            "standard": {
                "model": "anthropic/claude-3.5-haiku",
                "price_input_per_million_usd": 0.8,
                "price_output_per_million_usd": 4.0,
            },
            "heavy": {
                "model": "anthropic/claude-3.5-sonnet",
                "price_input_per_million_usd": 3.0,
                "price_output_per_million_usd": 15.0,
            },
        },
        ensure_ascii=False,
        indent=2,
    )


def validate_llm_tiers_json(raw: str) -> tuple[bool, str]:
    if not raw or not str(raw).strip():
        return True, ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return False, f"JSON invalide : {e}"
    if not isinstance(data, dict):
        return False, "Le JSON doit être un objet { \"lite\": { ... }, ... }."
    for k, v in data.items():
        if not re.match(r"^[a-z0-9_]{1,24}$", str(k).lower()):
            return False, f"Clé de palier invalide : {k!r}"
        if not isinstance(v, dict):
            return False, f"Valeur pour {k!r} : objet attendu."
        if not str(v.get("model") or "").strip():
            return False, f"Champ « model » manquant pour {k!r}."
    return True, ""
