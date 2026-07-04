"""API admin — recommandations de configuration système (sans écriture auto)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from auth import require_admin
from database import get_config_suggestion, list_config_suggestions, resolve_config_suggestion
from services.config_suggestions import scan_config_suggestions

router = APIRouter(tags=["config-suggestions"])


class ConfigSuggestionResolveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str  # dismiss | acknowledge


@router.get("/admin/config-suggestions", dependencies=[Depends(require_admin)])
def admin_config_suggestions_list(
    status: str | None = Query(default="pending"),
    limit: int = Query(default=40, ge=1, le=200),
):
    return {"suggestions": list_config_suggestions(status=status, limit=limit)}


@router.post("/admin/config-suggestions/scan", dependencies=[Depends(require_admin)])
def admin_config_suggestions_scan():
    created = scan_config_suggestions()
    return {"created": created, "count": len(created)}


@router.post("/admin/config-suggestions/{suggestion_id}/resolve", dependencies=[Depends(require_admin)])
def admin_config_suggestion_resolve(suggestion_id: str, body: ConfigSuggestionResolveBody):
    sug = get_config_suggestion(suggestion_id)
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion introuvable.")
    decision = (body.decision or "").strip().lower()
    if decision not in {"dismiss", "acknowledge"}:
        raise HTTPException(status_code=400, detail="decision doit être dismiss ou acknowledge.")
    status = "dismissed" if decision == "dismiss" else "acknowledged"
    return resolve_config_suggestion(suggestion_id, status)
