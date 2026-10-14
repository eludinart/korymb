"""
Mélange de quotas gratuits (Groq par modèle, Gemini, OpenRouter :free).

Un 429 de quota journalier change de seau tout de suite : chaque modèle Groq
a son propre compteur. Les clés viennent de l'env ou des réglages runtime.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DAILY_MARKERS = (
    "per day",
    "tokens per day",
    "requests per day",
    "daily",
    "tpd",
    "rpd",
)
_ADVANCE_STATUSES = frozenset({401, 402, 403, 404, 408, 409, 429, 500, 502, 503, 529})
_MODEL_ERROR_MARKERS = (
    "tool",
    "function",
    "not found",
    "does not exist",
    "unsupported",
    "not supported",
    "decommissioned",
    "model_not_found",
    "no endpoints",
)


@dataclass(frozen=True)
class PoolHop:
    id: str
    provider: str
    base_url: str
    api_key: str
    model: str
    tiers: tuple[str, ...]
    overflow: bool
    max_completion: int
    price_in: float = 0.0
    price_out: float = 0.0


def pool_mode(cfg: dict[str, Any] | None) -> str:
    raw = str((cfg or {}).get("llm_free_pool") or os.getenv("LLM_FREE_POOL") or "auto").strip().lower()
    if raw in ("1", "true", "on", "yes"):
        return "on"
    if raw in ("0", "false", "off", "no"):
        return "off"
    return "auto"


def _catalog(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    raw = str(cfg.get("llm_free_pool_json") or os.getenv("LLM_FREE_POOL_JSON") or "").strip()
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("LLM_FREE_POOL_JSON invalide — catalogue par défaut")
            data = None
        if isinstance(data, list) and data:
            return [row for row in data if isinstance(row, dict)]
    gemini_model = str(cfg.get("gemini_model") or os.getenv("GEMINI_MODEL") or "gemini-3.1-flash-lite").strip()
    openrouter_free = str(
        os.getenv("OPENROUTER_FREE_MODEL") or "cohere/north-mini-code:free"
    ).strip()
    openrouter_free_backup = str(
        os.getenv("OPENROUTER_FREE_MODEL_BACKUP") or "nvidia/nemotron-3-ultra-550b-a55b:free"
    ).strip()
    return [
        {
            "id": "groq-20b",
            "provider": "groq",
            "key": "groq",
            "base_url": "https://api.groq.com/openai/v1",
            "model": os.getenv("GROQ_MODEL_LITE", "openai/gpt-oss-20b"),
            "tiers": ["lite"],
            "max_completion": 4096,
        },
        {
            "id": "groq-qwen",
            "provider": "groq",
            "key": "groq",
            "base_url": "https://api.groq.com/openai/v1",
            "model": os.getenv("GROQ_MODEL_STANDARD", "qwen/qwen3.8-27b"),
            "tiers": ["standard"],
            "max_completion": 8192,
        },
        {
            "id": "groq-120b",
            "provider": "groq",
            "key": "groq",
            "base_url": "https://api.groq.com/openai/v1",
            "model": os.getenv("GROQ_MODEL_HEAVY", "openai/gpt-oss-120b"),
            "tiers": ["heavy"],
            "max_completion": 16384,
        },
        {
            "id": "gemini",
            "provider": "gemini",
            "key": "gemini",
            "base_url": os.getenv(
                "GEMINI_BASE_URL",
                "https://generativelanguage.googleapis.com/v1beta/openai",
            ),
            "model": gemini_model,
            "tiers": [],
            "overflow": True,
            "max_completion": 8192,
        },
        {
            "id": "openrouter-free",
            "provider": "openrouter",
            "key": "openrouter",
            "base_url": str(cfg.get("openrouter_base_url") or "https://openrouter.ai/api/v1"),
            "model": openrouter_free,
            "tiers": [],
            "overflow": True,
            "max_completion": 8192,
        },
        {
            "id": "openrouter-free-backup",
            "provider": "openrouter",
            "key": "openrouter",
            "base_url": str(cfg.get("openrouter_base_url") or "https://openrouter.ai/api/v1"),
            "model": openrouter_free_backup,
            "tiers": [],
            "overflow": True,
            "max_completion": 8192,
        },
    ]


def _api_key(cfg: dict[str, Any], name: str) -> str:
    """Clé du mélange. Une valeur vide dans la config effective n'est pas remplacée par l'env."""
    fields = {
        "groq": ("groq_api_key", "GROQ_API_KEY"),
        "gemini": ("gemini_api_key", "GEMINI_API_KEY"),
        "openrouter": ("openrouter_api_key", "OPENROUTER_API_KEY"),
    }
    field, env_name = fields.get(name, ("", ""))
    if not field:
        return ""
    if field in cfg:
        return str(cfg.get(field) or "").strip()
    return str(os.getenv(env_name) or "").strip()


def configured_hops(cfg: dict[str, Any]) -> list[PoolHop]:
    hops: list[PoolHop] = []
    for row in _catalog(cfg):
        key_name = str(row.get("key") or row.get("provider") or "").strip().lower()
        api_key = _api_key(cfg, key_name)
        model = str(row.get("model") or "").strip()
        base = str(row.get("base_url") or "").strip()
        if not api_key or not model or not base:
            continue
        tiers_raw = row.get("tiers") or []
        tiers = tuple(str(t).strip().lower() for t in tiers_raw if str(t).strip()) if isinstance(tiers_raw, list) else ()
        try:
            cap = int(row.get("max_completion") or 8192)
        except (TypeError, ValueError):
            cap = 8192
        hops.append(
            PoolHop(
                id=str(row.get("id") or model)[:64],
                provider=str(row.get("provider") or key_name)[:24],
                base_url=base,
                api_key=api_key,
                model=model[:200],
                tiers=tiers,
                overflow=bool(row.get("overflow")),
                max_completion=max(256, cap),
            )
        )
    return hops


def free_pool_active(cfg: dict[str, Any] | None) -> bool:
    mode = pool_mode(cfg)
    if mode == "off":
        return False
    hops = configured_hops(cfg or {})
    if mode == "on":
        return True
    return any(h.provider in ("groq", "gemini") for h in hops)


def order_hops(hops: list[PoolHop], profile: str, *, prefer_id: str | None = None) -> list[PoolHop]:
    """Le palier demandé d'abord, puis les autres seaux Groq, puis les secours."""
    prof = (profile or "lite").strip().lower()
    primary = [h for h in hops if prof in h.tiers and not h.overflow]
    others = [h for h in hops if h not in primary and not h.overflow]
    if prof == "heavy":
        others = list(reversed(others))
    overflow = [h for h in hops if h.overflow]
    ordered = primary + others + overflow
    if prefer_id:
        sticky = [h for h in ordered if h.id == prefer_id]
        rest = [h for h in ordered if h.id != prefer_id]
        ordered = sticky + rest
    return ordered


def _headers(hop: PoolHop, cfg: dict[str, Any]) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {hop.api_key}",
        "Content-Type": "application/json",
    }
    if hop.provider == "openrouter":
        ref = str(cfg.get("openrouter_http_referer") or "").strip()
        if ref:
            headers["HTTP-Referer"] = ref
        title = str(cfg.get("openrouter_app_title") or "Korymb").strip()
        if title:
            headers["X-Title"] = title
    return headers


def _body_for(hop: PoolHop, body: dict[str, Any], profile: str) -> dict[str, Any]:
    out = dict(body)
    out["model"] = hop.model
    try:
        asked = int(out.get("max_tokens") or 0)
    except (TypeError, ValueError):
        asked = 0
    if asked > hop.max_completion:
        out["max_tokens"] = hop.max_completion
    if hop.provider == "groq":
        out.setdefault("reasoning_effort", "medium" if profile == "heavy" else "low")
    return out


def _meta(hop: PoolHop, profile: str) -> dict[str, Any]:
    primary = profile in hop.tiers and not hop.overflow
    return {
        "hop_id": hop.id,
        "provider": hop.provider,
        "model": hop.model,
        "tier": profile if primary else f"{profile}→{hop.id}",
        "price_in": hop.price_in,
        "price_out": hop.price_out,
        "pooled": True,
    }


def _chat_url(base_url: str) -> str:
    from llm_client import _normalize_chat_completions_url

    return _normalize_chat_completions_url(base_url)


def _response_text(response: httpx.Response) -> str:
    try:
        return response.text or ""
    except Exception:
        return ""


def is_daily_quota(response: httpx.Response) -> bool:
    text = _response_text(response).lower()
    return any(marker in text for marker in _DAILY_MARKERS)


def should_advance(response: httpx.Response) -> bool:
    status = response.status_code
    if status in _ADVANCE_STATUSES:
        return True
    if status not in (400, 422):
        return False
    text = _response_text(response).lower()
    return any(marker in text for marker in _MODEL_ERROR_MARKERS)


def _single_meta(cfg: dict[str, Any], body: dict[str, Any], profile: str) -> tuple[str, dict[str, str], dict[str, Any], dict[str, Any]]:
    from llm_client import _normalize_model_id
    from llm_providers import chat_completions_settings, normalize_llm_provider
    from llm_tiers import resolve_llm_tier

    prov = normalize_llm_provider(None, cfg)
    cc = chat_completions_settings(cfg, prov)
    model, tier_key, pin, pout = resolve_llm_tier(cfg, profile, provider=prov)
    model_id = _normalize_model_id(model, fallback=cc["fallback_model"])
    payload = dict(body)
    payload["model"] = model_id
    headers = {
        "Authorization": f"Bearer {cc['api_key']}",
        "Content-Type": "application/json",
        **(cc.get("extra_headers") or {}),
    }
    meta = {
        "hop_id": "primary",
        "provider": str(cc["provider"]),
        "model": model_id,
        "tier": tier_key,
        "price_in": float(pin),
        "price_out": float(pout),
        "pooled": False,
    }
    return _chat_url(str(cc["base_url"])), headers, payload, meta


def post_with_failover(
    client: httpx.Client,
    cfg: dict[str, Any],
    body: dict[str, Any],
    *,
    profile: str = "lite",
    prefer_id: str | None = None,
    max_retries: int | None = None,
) -> tuple[httpx.Response, dict[str, Any]]:
    """POST /chat/completions. Hors mélange : le fournisseur actif. Dedans : seau suivant sur 429."""
    prof = (profile or "lite").strip().lower()
    if not free_pool_active(cfg):
        from llm_client import openrouter_post_with_retries

        url, headers, payload, meta = _single_meta(cfg, body, prof)
        response = openrouter_post_with_retries(
            client, url, headers, payload, max_retries=max_retries
        )
        return response, meta

    hops = order_hops(configured_hops(cfg), prof, prefer_id=prefer_id)
    if not hops:
        raise RuntimeError(
            "Mélange gratuit actif, mais aucune clé utilisable "
            "(GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_API_KEY)."
        )

    last: httpx.Response | None = None
    last_meta: dict[str, Any] = _meta(hops[-1], prof)
    skipped_keys: set[str] = set()
    usable = [h for h in hops]
    for index, hop in enumerate(usable):
        if hop.api_key in skipped_keys:
            continue
        payload = _body_for(hop, body, prof)
        headers = _headers(hop, cfg)
        url = _chat_url(hop.base_url)
        meta = _meta(hop, prof)
        response = client.post(url, json=payload, headers=headers)
        if (
            response.status_code in (400, 422)
            and "reasoning_effort" in payload
            and "reasoning" in _response_text(response).lower()
        ):
            payload = dict(payload)
            payload.pop("reasoning_effort", None)
            response = client.post(url, json=payload, headers=headers)
        last, last_meta = response, meta
        if response.status_code < 400:
            if index:
                logger.warning("LLM mélange : %s après échec des seaux précédents", hop.id)
            return response, meta
        if response.status_code in (401, 403):
            skipped_keys.add(hop.api_key)
            logger.warning("LLM mélange : %s HTTP %s — clé ignorée", hop.id, response.status_code)
            continue
        remaining = [h for h in usable[index + 1 :] if h.api_key not in skipped_keys]
        last_hop = not remaining
        if should_advance(response) and not last_hop:
            logger.warning(
                "LLM mélange : %s HTTP %s — seau suivant",
                hop.id,
                response.status_code,
            )
            continue
        if last_hop and should_advance(response) and not is_daily_quota(response):
            response = _retry_last(client, url, headers, payload, response, max_retries=max_retries)
            return response, meta
        return response, meta
    assert last is not None
    return last, last_meta


def _retry_last(
    client: httpx.Client,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    response: httpx.Response,
    *,
    max_retries: int | None,
) -> httpx.Response:
    limit = 3 if max_retries is None else max(1, int(max_retries))
    wait = 0.4
    for attempt in range(1, limit):
        if response.status_code not in (429, 502, 503) or is_daily_quota(response):
            return response
        time.sleep(wait)
        wait = min(wait * 2, 4.0)
        response = client.post(url, json=payload, headers=headers)
        logger.warning("LLM mélange : dernier seau, nouvel essai %d/%d", attempt + 1, limit)
    return response


def free_pool_public(cfg: dict[str, Any]) -> dict[str, Any]:
    """Résumé sans secrets pour l'admin et /health."""
    hops = configured_hops(cfg)
    visible: list[dict[str, Any]] = []
    for hop in hops:
        if hop.overflow:
            role = "secours"
        elif "lite" in hop.tiers:
            role = "courant"
        elif "standard" in hop.tiers:
            role = "médium"
        elif "heavy" in hop.tiers:
            role = "expert"
        else:
            role = "seau"
        visible.append(
            {
                "id": hop.id,
                "provider": hop.provider,
                "model": hop.model,
                "role": role,
                "tiers": list(hop.tiers),
            }
        )
    return {
        "mode": pool_mode(cfg),
        "active": free_pool_active(cfg),
        "hops": visible,
    }


def hop_attempts(
    cfg: dict[str, Any],
    body: dict[str, Any],
    profile: str,
    *,
    prefer_id: str | None = None,
) -> list[tuple[str, dict[str, str], dict[str, Any], dict[str, Any]]]:
    """URL, en-têtes, corps, méta — pour le flux qui ouvre lui-même le stream."""
    prof = (profile or "lite").strip().lower()
    hops = order_hops(configured_hops(cfg), prof, prefer_id=prefer_id)
    out: list[tuple[str, dict[str, str], dict[str, Any], dict[str, Any]]] = []
    for hop in hops:
        out.append((_chat_url(hop.base_url), _headers(hop, cfg), _body_for(hop, body, prof), _meta(hop, prof)))
    return out
