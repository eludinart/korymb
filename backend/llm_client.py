"""
Appels LLM unifiés : Anthropic (API native) ou OpenRouter (compatible OpenAI /chat/completions).
Configuration : .env + surcharges `runtime_settings.merge_with_env()`.
"""
from __future__ import annotations

import logging
import os
import random
import time
from typing import Any

import anthropic
import httpx

from runtime_settings import merge_with_env

from llm_tiers import resolve_openrouter_tier

logger = logging.getLogger(__name__)

_UNSET = object()


def log_llm_call_financial(
    *,
    provider: str,
    model: str,
    tier: str,
    tokens_in: int,
    tokens_out: int,
    price_input_per_million: float,
    price_output_per_million: float,
    job_id: Any = _UNSET,
    context_label: Any = _UNSET,
) -> None:
    """Persiste une ligne d’usage pour agrégats de coût (ne doit pas faire échouer l’appel LLM)."""
    try:
        from llm_usage_context import get_usage_context_label, get_usage_job_id

        from database import log_llm_usage_event

        jid = get_usage_job_id() if job_id is _UNSET else (job_id or None)
        ctx = get_usage_context_label() if context_label is _UNSET else str(context_label or "")[:120]
        cost = (
            float(tokens_in) * float(price_input_per_million)
            + float(tokens_out) * float(price_output_per_million)
        ) / 1_000_000.0
        log_llm_usage_event(
            job_id=jid,
            context_label=ctx,
            tier=tier[:32],
            model=model[:200],
            provider=provider[:24],
            tokens_in=int(tokens_in),
            tokens_out=int(tokens_out),
            cost_usd=float(cost),
        )
    except Exception:
        logger.exception("log_llm_call_financial")

_OPENROUTER_RETRY_STATUS = frozenset({429, 503})
_OPENROUTER_MAX_RETRIES = max(1, int(os.getenv("OPENROUTER_MAX_RETRIES", "6")))


def _normalize_chat_completions_url(base_url: str) -> str:
    """Accepte une base API ou un endpoint complet /chat/completions."""
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        return "https://openrouter.ai/api/v1/chat/completions"
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _normalize_model_id(model: Any, *, fallback: str) -> str:
    """
    Garantit un model_id unique.
    Protège contre une valeur saisie comme liste CSV dans les réglages.
    """
    raw = str(model or "").strip()
    if not raw:
        return fallback
    if "," in raw:
        chosen = raw.split(",", 1)[0].strip()
        if chosen:
            logger.warning("Model ID CSV détecté, premier modèle retenu: %s", chosen)
            return chosen
    return raw


def format_llm_provider_http_error(response: httpx.Response, *, max_chars: int = 900) -> str:
    """
    Message court à afficher quand /chat/completions renvoie une erreur (OpenRouter, etc.).
    """
    raw = (response.text or "").strip().replace("\r\n", "\n")
    preview = raw if len(raw) <= max_chars else raw[: max_chars - 3] + "..."
    try:
        data = response.json()
    except Exception:
        return preview or f"Réponse vide (HTTP {response.status_code})."
    if not isinstance(data, dict):
        return preview or f"HTTP {response.status_code}"
    err = data.get("error")
    if isinstance(err, dict):
        inner = err.get("message") or err.get("msg") or err.get("code")
        if inner is not None and str(inner).strip():
            return str(inner).strip()[:max_chars]
    if isinstance(err, str) and err.strip():
        return err.strip()[:max_chars]
    for key in ("message", "detail"):
        v = data.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()[:max_chars]
    return preview or f"HTTP {response.status_code}"


def openrouter_post_with_retries(
    client: httpx.Client,
    url: str,
    headers: dict[str, str],
    json_body: dict[str, Any],
) -> httpx.Response:
    """POST /chat/completions avec backoff sur 429 / 503 (plans gratuits, orchestration multi-appels)."""
    wait = 0.0
    for attempt in range(_OPENROUTER_MAX_RETRIES):
        r = client.post(url, json=json_body, headers=headers)
        if r.status_code not in _OPENROUTER_RETRY_STATUS:
            return r
        ra = r.headers.get("retry-after") or r.headers.get("Retry-After")
        if ra:
            try:
                wait = float(ra)
            except (TypeError, ValueError):
                wait = 0.0
        if wait <= 0:
            wait = min(60.0, (2**attempt) + random.uniform(0.2, 1.2))
        logger.warning(
            "OpenRouter %s — attente %.1fs avant nouvel essai (%d/%d)",
            r.status_code,
            wait,
            attempt + 1,
            _OPENROUTER_MAX_RETRIES,
        )
        time.sleep(wait)
        wait = 0.0
    raise RuntimeError(
        "OpenRouter limite le débit (HTTP 429 ou 503 après plusieurs tentatives). "
        "Le plan gratuit et le CIO (plusieurs appels d’affilée) saturent vite : attends 1–2 minutes, "
        "réduis la fréquence, ou utilise un modèle / une clé moins contraint."
    )


def _message_content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" and "text" in block:
                    parts.append(str(block["text"]))
                elif "text" in block:
                    parts.append(str(block["text"]))
            else:
                parts.append(str(block))
        return "".join(parts)
    return str(content)


def _assert_llm_ready(cfg: dict[str, Any]) -> None:
    prov = str(cfg.get("llm_provider") or "anthropic")
    if prov == "openrouter" and not str(cfg.get("openrouter_api_key") or "").strip():
        raise RuntimeError("OPENROUTER_API_KEY manquant (env ou fichier runtime_settings.json)")
    if prov == "anthropic" and not str(cfg.get("anthropic_api_key") or "").strip():
        raise RuntimeError("ANTHROPIC_API_KEY manquant (env ou fichier runtime_settings.json)")


def _openrouter_chat(
    messages: list[dict[str, str]],
    max_tokens: int,
    cfg: dict[str, Any],
    *,
    or_profile: str = "lite",
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
) -> tuple[str, int, int]:
    _assert_llm_ready(cfg)
    base = str(cfg.get("openrouter_base_url") or "https://openrouter.ai/api/v1")
    url = _normalize_chat_completions_url(base)
    headers = {
        "Authorization": f"Bearer {cfg['openrouter_api_key']}",
        "Content-Type": "application/json",
    }
    ref = str(cfg.get("openrouter_http_referer") or "").strip()
    if ref:
        headers["HTTP-Referer"] = ref
    title = str(cfg.get("openrouter_app_title") or "").strip()
    if title:
        headers["X-Title"] = title

    model, tier_key, pin, pout = resolve_openrouter_tier(cfg, or_profile)
    model_id = _normalize_model_id(model, fallback="openai/gpt-4o-mini")
    body = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    with httpx.Client(timeout=120.0) as client:
        r = openrouter_post_with_retries(client, url, headers, body)
    if r.status_code >= 400:
        hint = format_llm_provider_http_error(r)
        logger.warning("LLM HTTP %s — %s", r.status_code, r.text[:800])
        raise RuntimeError(
            f"Le fournisseur LLM a répondu HTTP {r.status_code}. {hint}"
        ) from None
    data = r.json()
    try:
        text = _message_content_to_text(data["choices"][0]["message"].get("content"))
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"Réponse OpenRouter inattendue : {data!r}") from e
    usage = data.get("usage") or {}
    pt = int(usage.get("prompt_tokens") or 0)
    ct = int(usage.get("completion_tokens") or 0)
    log_llm_call_financial(
        provider="openrouter",
        model=model_id,
        tier=tier_key,
        tokens_in=pt,
        tokens_out=ct,
        price_input_per_million=pin,
        price_output_per_million=pout,
        job_id=usage_job_id,
        context_label=usage_context,
    )
    return text, pt, ct


def llm_turn(
    system: str,
    user_text: str,
    max_tokens: int = 4096,
    *,
    or_profile: str = "lite",
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
) -> tuple[str, int, int]:
    cfg = merge_with_env()
    prov = str(cfg.get("llm_provider") or "anthropic")
    if prov == "openrouter":
        messages: list[dict[str, str]] = []
        if system.strip():
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user_text})
        return _openrouter_chat(
            messages,
            max_tokens,
            dict(cfg),
            or_profile=or_profile,
            usage_job_id=usage_job_id,
            usage_context=usage_context,
        )

    _assert_llm_ready(cfg)
    model = str(cfg.get("anthropic_model") or "claude-sonnet-4-6")
    pin = float(cfg.get("llm_price_input_per_million_usd") or 0)
    pout = float(cfg.get("llm_price_output_per_million_usd") or 0)
    client = anthropic.Anthropic(api_key=str(cfg["anthropic_api_key"]))
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_text}],
    )
    tin = int(resp.usage.input_tokens or 0)
    tout = int(resp.usage.output_tokens or 0)
    log_llm_call_financial(
        provider="anthropic",
        model=model,
        tier="anthropic",
        tokens_in=tin,
        tokens_out=tout,
        price_input_per_million=pin,
        price_output_per_million=pout,
        job_id=usage_job_id,
        context_label=usage_context,
    )
    return resp.content[0].text, tin, tout


def llm_chat(
    system: str,
    messages: list[dict],
    max_tokens: int = 2048,
    *,
    or_profile: str = "lite",
    usage_job_id: Any = _UNSET,
    usage_context: Any = _UNSET,
) -> tuple[str, int, int]:
    cfg = merge_with_env()
    prov = str(cfg.get("llm_provider") or "anthropic")
    if prov == "openrouter":
        om: list[dict[str, str]] = []
        if system.strip():
            om.append({"role": "system", "content": system})
        for m in messages:
            if m.get("role") not in ("user", "assistant"):
                continue
            c = m.get("content")
            if not isinstance(c, str):
                continue
            om.append({"role": m["role"], "content": c})
        return _openrouter_chat(
            om,
            max_tokens,
            dict(cfg),
            or_profile=or_profile,
            usage_job_id=usage_job_id,
            usage_context=usage_context,
        )

    _assert_llm_ready(cfg)
    model = str(cfg.get("anthropic_model") or "claude-sonnet-4-6")
    pin = float(cfg.get("llm_price_input_per_million_usd") or 0)
    pout = float(cfg.get("llm_price_output_per_million_usd") or 0)
    client = anthropic.Anthropic(api_key=str(cfg["anthropic_api_key"]))
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": m["role"], "content": m["content"]} for m in messages if m.get("role") in ("user", "assistant")],
    )
    tin = int(resp.usage.input_tokens or 0)
    tout = int(resp.usage.output_tokens or 0)
    log_llm_call_financial(
        provider="anthropic",
        model=model,
        tier="anthropic",
        tokens_in=tin,
        tokens_out=tout,
        price_input_per_million=pin,
        price_output_per_million=pout,
        job_id=usage_job_id,
        context_label=usage_context,
    )
    return resp.content[0].text, tin, tout
