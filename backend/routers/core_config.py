from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from runtime_settings import merge_with_env, save_partial, to_public_dict

router = APIRouter(tags=["config"])


class AdminSettingsPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    llm_provider: str | None = None
    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    openrouter_api_key: str | None = None
    openrouter_model: str | None = None
    openrouter_base_url: str | None = None
    openrouter_http_referer: str | None = None
    openrouter_app_title: str | None = None
    llm_price_input_per_million_usd: float | None = None
    llm_price_output_per_million_usd: float | None = None
    llm_tiers_json: str | None = None


class BudgetSettingsPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    token_alert_threshold: int | None = Field(None, ge=0)
    daily_budget_usd: float | None = Field(None, ge=0)
    llm_price_input_per_million_usd: float | None = Field(None, ge=0)
    llm_price_output_per_million_usd: float | None = Field(None, ge=0)


@router.get("/admin/settings", dependencies=[Depends(verify_secret)])
def admin_get_llm_settings():
    """Lecture config LLM effective (clés API masquées, flags *_set)."""
    return to_public_dict(merge_with_env())


@router.put("/admin/settings", dependencies=[Depends(verify_secret)])
def admin_put_llm_settings(body: AdminSettingsPut):
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "llm_provider" in data and str(data["llm_provider"]) not in ("anthropic", "openrouter"):
        raise HTTPException(status_code=400, detail="llm_provider doit être anthropic ou openrouter")
    try:
        merged = save_partial(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return to_public_dict(merged)


@router.get("/config/budget", dependencies=[Depends(verify_secret)])
def budget_get():
    """Lecture des paramètres budget & coût."""
    cfg = merge_with_env()
    return {
        "token_alert_threshold": cfg.get("token_alert_threshold", 30000),
        "daily_budget_usd": float(cfg.get("daily_budget_usd") or 0.0),
        "llm_price_input_per_million_usd": float(cfg.get("llm_price_input_per_million_usd") or 3.0),
        "llm_price_output_per_million_usd": float(cfg.get("llm_price_output_per_million_usd") or 15.0),
    }


@router.put("/config/budget", dependencies=[Depends(verify_secret)])
def budget_put(body: BudgetSettingsPut):
    """Mise à jour des paramètres budget & coût (persistés dans runtime_settings.json)."""
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if not data:
        return budget_get()
    try:
        save_partial(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return budget_get()

