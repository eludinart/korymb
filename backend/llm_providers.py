"""Réglages par fournisseur pour les API compatibles OpenAI /chat/completions."""
from __future__ import annotations

from typing import Any

CHAT_COMPLETIONS_PROVIDERS = frozenset({"openrouter", "mistral"})


def normalize_llm_provider(provider: str | None, cfg: dict[str, Any] | None = None) -> str:
    p = str(provider or (cfg or {}).get("llm_provider") or "mistral").strip().lower()
    if p == "google":
        return "openrouter"
    return p


def is_chat_completions_provider(provider: str | None, cfg: dict[str, Any] | None = None) -> bool:
    return normalize_llm_provider(provider, cfg) in CHAT_COMPLETIONS_PROVIDERS


def chat_completions_settings(cfg: dict[str, Any], provider: str | None = None) -> dict[str, Any]:
    """Clé API, URL de base, en-têtes optionnels et modèle de secours."""
    p = normalize_llm_provider(provider, cfg)
    if p == "mistral":
        key = str(cfg.get("mistral_api_key") or "").strip()
        if not key:
            raise RuntimeError("MISTRAL_API_KEY manquant (env ou fichier runtime_settings.json)")
        return {
            "provider": "mistral",
            "api_key": key,
            "base_url": str(cfg.get("mistral_base_url") or "https://api.mistral.ai/v1").strip(),
            "extra_headers": {},
            "fallback_model": str(cfg.get("mistral_model") or "mistral-small-latest").strip(),
        }
    if p == "openrouter":
        key = str(cfg.get("openrouter_api_key") or "").strip()
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY manquant (env ou fichier runtime_settings.json)")
        headers: dict[str, str] = {}
        ref = str(cfg.get("openrouter_http_referer") or "").strip()
        if ref:
            headers["HTTP-Referer"] = ref
        title = str(cfg.get("openrouter_app_title") or "").strip()
        if title:
            headers["X-Title"] = title
        return {
            "provider": "openrouter",
            "api_key": key,
            "base_url": str(cfg.get("openrouter_base_url") or "https://openrouter.ai/api/v1").strip(),
            "extra_headers": headers,
            "fallback_model": str(cfg.get("openrouter_model") or "openai/gpt-4o-mini").strip(),
        }
    raise ValueError(f"Fournisseur incompatible chat/completions : {p!r}")
