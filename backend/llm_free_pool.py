"""
Mélange de quotas gratuits (Groq par modèle, Gemini, OpenRouter :free).

Un 429 de quota journalier, un 413 (plafond de jetons) ou un modèle
injoignable change de seau : chaque modèle Groq a son propre compteur.
Les clés viennent de l'env ou des réglages runtime.
"""
from __future__ import annotations

import json
import logging
import os
import re
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
_ADVANCE_STATUSES = frozenset({401, 402, 403, 404, 408, 409, 413, 429, 500, 502, 503, 529})
_MODEL_ERROR_MARKERS = (
    "tool",
    "function",
    "not found",
    "does not exist",
    "not a valid model",
    "invalid model",
    "unknown model",
    "unsupported",
    "not supported",
    "decommissioned",
    "model_not_found",
    "no endpoints",
    # gpt-oss (Groq) : le gabarit minijinja lève cette exception s'il ne voit
    # aucun tour user — outils, reasoning_effort, ou prompt réduit trop fort.
    "no user query",
    "minijinja",
    "failed to template",
    "failed to render",
    "rendering failed",
)
# Groq gratuit : 8 000 jetons/minute pour la requête entière. On garde la place du max_tokens.
_GROQ_INPUT_TOKEN_BUDGET = 5600


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
    paid: bool = False


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
        os.getenv("OPENROUTER_FREE_MODEL") or "deepseek/deepseek-v4-flash:free"
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
        {
            "id": "deepseek-paid",
            "provider": "deepseek",
            "key": "deepseek",
            "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            "model": os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
            "tiers": [],
            "overflow": True,
            "paid": True,
            "max_completion": 8192,
        },
    ]


def _api_key(cfg: dict[str, Any], name: str) -> str:
    """Clé du mélange. Une valeur vide dans la config effective n'est pas remplacée par l'env."""
    fields = {
        "groq": ("groq_api_key", "GROQ_API_KEY"),
        "gemini": ("gemini_api_key", "GEMINI_API_KEY"),
        "openrouter": ("openrouter_api_key", "OPENROUTER_API_KEY"),
        "deepseek": ("deepseek_api_key", "DEEPSEEK_API_KEY"),
        "mistral": ("mistral_api_key", "MISTRAL_API_KEY"),
        "anthropic": ("anthropic_api_key", "ANTHROPIC_API_KEY"),
    }
    field, env_name = fields.get(name, ("", ""))
    if not field:
        return ""
    if field in cfg:
        return str(cfg.get(field) or "").strip()
    return str(os.getenv(env_name) or "").strip()


def _split_models(*raws: Any) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in raws:
        for part in str(raw or "").split(","):
            model = part.strip()
            if model and model not in seen:
                seen.add(model)
                out.append(model)
    return out


def _extra_model_rows(cfg: dict[str, Any], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Modèles des clés déjà enregistrées (Mistral, Anthropic, OpenRouter), absents du mélange gratuit."""
    from llm_tiers import model_fits_provider

    taken = {(str(row.get("provider") or ""), str(row.get("model") or "")) for row in existing}
    rows: list[dict[str, Any]] = []

    def add(provider: str, key: str, base: str, model: str, *, paid: bool) -> None:
        if not model or (provider, model) in taken:
            return
        taken.add((provider, model))
        slug = re.sub(r"[^a-z0-9]+", "-", model.lower()).strip("-")[:40]
        rows.append(
            {
                "id": f"{provider}-{slug}"[:64],
                "provider": provider,
                "key": key,
                "base_url": base,
                "model": model,
                "tiers": [],
                "overflow": True,
                "paid": paid,
                "max_completion": 8192,
            }
        )

    if _api_key(cfg, "mistral"):
        base = str(cfg.get("mistral_base_url") or "https://api.mistral.ai/v1").strip()
        for model in _split_models(cfg.get("mistral_models"), cfg.get("mistral_model")):
            if model_fits_provider(model, "mistral"):
                add("mistral", "mistral", base, model, paid=True)
    if _api_key(cfg, "openrouter"):
        base = str(cfg.get("openrouter_base_url") or "https://openrouter.ai/api/v1").strip()
        for model in _split_models(cfg.get("openrouter_models"), cfg.get("openrouter_model")):
            if model_fits_provider(model, "openrouter"):
                add("openrouter", "openrouter", base, model, paid=":free" not in model)
    if _api_key(cfg, "anthropic"):
        for model in _split_models(cfg.get("anthropic_models"), cfg.get("anthropic_model")):
            if model_fits_provider(model, "anthropic"):
                add("anthropic", "anthropic", "https://api.anthropic.com/v1", model, paid=True)
    return rows


def _catalog_rows(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    rows = list(_catalog(cfg))
    tail = [row for row in rows if row.get("id") == "deepseek-paid"]
    head = [row for row in rows if row.get("id") != "deepseek-paid"]
    head.extend(_extra_model_rows(cfg, head))
    return head + tail


def configured_hops(cfg: dict[str, Any]) -> list[PoolHop]:
    hops: list[PoolHop] = []
    for row in _catalog_rows(cfg):
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
                paid=bool(row.get("paid")),
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


def _estimate_tokens(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return (len(value) + 3) // 4
    try:
        raw = json.dumps(value, ensure_ascii=False)
    except TypeError:
        raw = str(value)
    return (len(raw) + 3) // 4


def _fit_groq_messages(messages: list[Any], tools: Any, budget: int = _GROQ_INPUT_TOKEN_BUDGET) -> list[dict[str, Any]]:
    """Garde le système, la dernière question utilisateur, et la suite d'outils.

    Le gabarit Groq gpt-oss refuse la requête (« No user query found ») si le
    tour user a été retiré pour faire tenir un résultat d'outil.
    """
    rows = [dict(item) for item in messages if isinstance(item, dict)]
    tool_cost = _estimate_tokens(tools)

    def cost(items: list[dict[str, Any]]) -> int:
        return tool_cost + sum(
            _estimate_tokens(item.get("content")) + _estimate_tokens(item.get("tool_calls")) + 4
            for item in items
        )

    if cost(rows) <= budget and _last_user_index(rows) >= 0:
        return rows
    systems: list[dict[str, Any]] = []
    rest: list[dict[str, Any]] = []
    for item in rows:
        if item.get("role") == "system" and not rest:
            systems.append(dict(item))
        else:
            empty_assistant = (
                item.get("role") == "assistant"
                and not str(item.get("content") or "").strip()
                and not item.get("tool_calls")
            )
            if empty_assistant:
                continue
            rest.append(dict(item))
    if not rest:
        rest = systems
        systems = []
    user_at = _last_user_index(rest)
    if user_at >= 0:
        older = rest[:user_at]
        protected = rest[user_at:]
    else:
        older = rest[:-1]
        protected = rest[-1:]
    while older and cost(systems + older + protected) > budget:
        older.pop(0)
    fitted = systems + older + protected
    if cost(fitted) > budget:
        protect = {_last_user_index(fitted)}
        _shrink_contents(fitted, budget, protect_indexes=protect, cost=cost)
    if _last_user_index(fitted) < 0 and user_at >= 0:
        fitted.append(dict(rest[user_at]))
    if cost(rows) > budget:
        logger.warning("LLM mélange : prompt Groq réduit sous %s jetons estimés", budget)
    return fitted


def _last_user_index(items: list[dict[str, Any]]) -> int:
    found = -1
    for index, item in enumerate(items):
        if item.get("role") == "user" and str(item.get("content") or "").strip():
            found = index
    return found


def _shrink_contents(
    items: list[dict[str, Any]],
    budget: int,
    *,
    protect_indexes: set[int],
    cost: Any,
) -> None:
    """Raccourcit le système puis les résultats d'outils. La question utilisateur reste entière tant qu'elle tient."""
    for index, item in enumerate(items):
        if cost(items) <= budget or index in protect_indexes:
            continue
        content = item.get("content")
        if not isinstance(content, str) or len(content) < 80:
            continue
        overhead = cost(items) - _estimate_tokens(content)
        room = max(80, (budget - overhead) * 4)
        if len(content) > room:
            item["content"] = content[:room]
    user_at = _last_user_index(items)
    if cost(items) <= budget or user_at < 0:
        return
    last = items[user_at]
    content = str(last.get("content") or "")
    overhead = cost(items) - _estimate_tokens(content)
    room = max(200, (budget - overhead) * 4)
    if len(content) > room:
        last["content"] = content[-room:]


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
        out["messages"] = _fit_groq_messages(list(out.get("messages") or []), out.get("tools"))
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


def request_too_large_for_provider(response: httpx.Response) -> bool:
    """413 Groq : la requête dépasse le plafond du modèle. Les autres modèles du même fournisseur échoueront pareil."""
    if response.status_code != 413:
        return False
    text = _response_text(response).lower()
    return "request too large" in text or "tokens per minute" in text or "rate_limit_exceeded" in text


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


def _anthropic_as_chat_response(hop: PoolHop, payload: dict[str, Any]) -> httpx.Response:
    """Traduit un tour Anthropic vers la forme chat/completions attendue par le mélange."""
    if payload.get("tools"):
        return httpx.Response(
            400,
            json={"error": {"message": "tool calling is not supported on this anthropic hop"}},
        )
    system_parts: list[str] = []
    messages: list[dict[str, str]] = []
    for item in payload.get("messages") or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "")
        content = item.get("content")
        text = content if isinstance(content, str) else str(content or "")
        if role == "system":
            if text.strip():
                system_parts.append(text.strip())
        elif role in ("user", "assistant") and text.strip():
            messages.append({"role": role, "content": text})
    if not messages:
        messages = [{"role": "user", "content": "\n".join(system_parts) or "."}]
        system_parts = []
    try:
        import anthropic
    except ImportError:
        return httpx.Response(503, json={"error": {"message": "anthropic SDK missing"}})
    try:
        max_tokens = int(payload.get("max_tokens") or 1024)
    except (TypeError, ValueError):
        max_tokens = 1024
    kwargs: dict[str, Any] = {
        "model": hop.model,
        "max_tokens": max(1, max_tokens),
        "messages": messages,
    }
    system = "\n".join(system_parts).strip()
    if system:
        kwargs["system"] = system
    if payload.get("temperature") is not None:
        kwargs["temperature"] = float(payload["temperature"])
    try:
        resp = anthropic.Anthropic(api_key=hop.api_key).messages.create(**kwargs)
    except Exception as exc:
        status = getattr(exc, "status_code", None) or 502
        try:
            status = int(status)
        except (TypeError, ValueError):
            status = 502
        return httpx.Response(status, json={"error": {"message": str(exc)}})
    text = "".join(getattr(block, "text", "") for block in (resp.content or []))
    usage = getattr(resp, "usage", None)
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": text}}],
            "usage": {
                "prompt_tokens": int(getattr(usage, "input_tokens", 0) or 0),
                "completion_tokens": int(getattr(usage, "output_tokens", 0) or 0),
            },
        },
    )


def post_with_failover(
    client: httpx.Client,
    cfg: dict[str, Any],
    body: dict[str, Any],
    *,
    profile: str = "lite",
    prefer_id: str | None = None,
    max_retries: int | None = None,
) -> tuple[httpx.Response, dict[str, Any]]:
    """POST /chat/completions. Hors mélange : le fournisseur actif. Dedans : seau suivant si le modèle refuse ou ne répond pas."""
    prof = (profile or "lite").strip().lower()
    if not free_pool_active(cfg):
        from llm_client import openrouter_post_with_retries

        url, headers, payload, meta = _single_meta(cfg, body, prof)
        response = openrouter_post_with_retries(
            client, url, headers, payload, max_retries=max_retries
        )
        return response, meta

    if not prefer_id:
        prefer_id = preferred_hop_id(cfg)
    hops = order_hops(configured_hops(cfg), prof, prefer_id=prefer_id)
    if not hops:
        raise RuntimeError(
            "Mélange gratuit actif, mais aucune clé utilisable "
            "(GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_API_KEY)."
        )

    last: httpx.Response | None = None
    last_meta: dict[str, Any] = _meta(hops[-1], prof)
    skipped_keys: set[str] = set()
    skipped_providers: set[str] = set()
    usable = [h for h in hops]
    for index, hop in enumerate(usable):
        if hop.api_key in skipped_keys or hop.provider in skipped_providers:
            continue
        payload = _body_for(hop, body, prof)
        headers = _headers(hop, cfg)
        url = _chat_url(hop.base_url)
        meta = _meta(hop, prof)
        remaining = [
            h
            for h in usable[index + 1 :]
            if h.api_key not in skipped_keys and h.provider not in skipped_providers
        ]
        try:
            if hop.provider == "anthropic":
                response = _anthropic_as_chat_response(hop, payload)
            else:
                response = client.post(url, json=payload, headers=headers)
            if (
                response.status_code in (400, 422)
                and "reasoning_effort" in payload
                and "reasoning" in _response_text(response).lower()
            ):
                payload = dict(payload)
                payload.pop("reasoning_effort", None)
                response = client.post(url, json=payload, headers=headers)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            logger.warning(
                "LLM mélange : %s injoignable (%s) — %s",
                hop.id,
                type(exc).__name__,
                "seau suivant" if remaining else "dernier seau",
            )
            if remaining:
                continue
            raise
        last, last_meta = response, meta
        if response.status_code < 400:
            if index:
                logger.warning("LLM mélange : %s après échec des seaux précédents", hop.id)
            return response, meta
        if response.status_code in (401, 403):
            skipped_keys.add(hop.api_key)
            logger.warning("LLM mélange : %s HTTP %s — clé ignorée", hop.id, response.status_code)
            continue
        if request_too_large_for_provider(response):
            skipped_providers.add(hop.provider)
            logger.warning(
                "LLM mélange : %s HTTP 413 — fournisseur %s écarté",
                hop.id,
                hop.provider,
            )
            continue
        remaining = [
            h
            for h in usable[index + 1 :]
            if h.api_key not in skipped_keys and h.provider not in skipped_providers
        ]
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


def preferred_hop_id(cfg: dict[str, Any] | None) -> str | None:
    """Modèle de départ choisi dans le bandeau. Vide = ordre automatique."""
    raw = str((cfg or {}).get("llm_prefer_hop_id") or "").strip()
    if not raw or raw == "auto":
        return None
    return raw[:64]


def _hop_billing(hop: PoolHop) -> tuple[str, str]:
    if hop.provider == "mistral":
        return "payant", "Décompté sur le crédit Mistral"
    if hop.provider == "anthropic":
        return "payant", "Décompté sur le crédit Anthropic"
    if hop.paid or hop.provider == "deepseek":
        return "payant", "Solde du compte, hors quotas gratuits"
    if hop.provider == "groq":
        return "gratuit", "8 000 jetons/min · 200 000/jour · compteur à part"
    if hop.provider == "gemini":
        return "gratuit", "Quota Google, séparé de Groq"
    if hop.provider == "openrouter" and ":free" in hop.model:
        return "gratuit", "Plafond partagé entre les modèles gratuits OpenRouter"
    if hop.provider == "openrouter":
        return "payant", "Décompté sur le crédit OpenRouter"
    return "gratuit", "Quota du fournisseur"


def free_pool_public(cfg: dict[str, Any]) -> dict[str, Any]:
    """Résumé sans secrets pour l'admin et /health."""
    prefer = preferred_hop_id(cfg)
    hops = order_hops(configured_hops(cfg), "lite", prefer_id=prefer)
    visible: list[dict[str, Any]] = []
    for hop in hops:
        if hop.provider in ("mistral", "anthropic") or (hop.paid and hop.provider == "openrouter"):
            role = "configuré"
        elif hop.paid:
            role = "garanti"
        elif hop.overflow:
            role = "secours"
        elif "lite" in hop.tiers:
            role = "courant"
        elif "standard" in hop.tiers:
            role = "médium"
        elif "heavy" in hop.tiers:
            role = "expert"
        else:
            role = "seau"
        billing, quota = _hop_billing(hop)
        visible.append(
            {
                "id": hop.id,
                "provider": hop.provider,
                "model": hop.model,
                "role": role,
                "billing": billing,
                "quota": quota,
                "tiers": list(hop.tiers),
                "start": False,
            }
        )
    if visible:
        visible[0]["start"] = True
    return {
        "mode": pool_mode(cfg),
        "active": free_pool_active(cfg),
        "prefer_hop_id": prefer or "",
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
    if not prefer_id:
        prefer_id = preferred_hop_id(cfg)
    hops = order_hops(configured_hops(cfg), prof, prefer_id=prefer_id)
    out: list[tuple[str, dict[str, str], dict[str, Any], dict[str, Any]]] = []
    for hop in hops:
        out.append((_chat_url(hop.base_url), _headers(hop, cfg), _body_for(hop, body, prof), _meta(hop, prof)))
    return out
