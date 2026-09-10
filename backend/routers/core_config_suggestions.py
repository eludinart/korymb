"""API admin — recommandations de configuration système (sans écriture auto)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from auth import require_admin
from database import get_config_suggestion, list_config_suggestions, resolve_config_suggestion
from services.config_suggestions import (
    apply_config_suggestion,
    enrich_config_suggestion,
    scan_config_suggestions,
)

router = APIRouter(tags=["config-suggestions"])


class ConfigSuggestionResolveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    decision: str  # dismiss | acknowledge | apply


@router.get("/admin/config-suggestions", dependencies=[Depends(require_admin)])
def admin_config_suggestions_list(
    status: str | None = Query(default="pending"),
    limit: int = Query(default=40, ge=1, le=200),
):
    return {"suggestions": [enrich_config_suggestion(s) for s in list_config_suggestions(status=status, limit=limit)]}


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
    if decision not in {"dismiss", "acknowledge", "apply"}:
        raise HTTPException(status_code=400, detail="decision doit être dismiss, acknowledge ou apply.")
    if decision == "apply":
        try:
            return apply_config_suggestion(suggestion_id)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Application impossible : {exc}") from exc
    status = "dismissed" if decision == "dismiss" else "acknowledged"
    return enrich_config_suggestion(resolve_config_suggestion(suggestion_id, status))
