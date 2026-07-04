"""
routers/core_deliverables.py — Bibliothèque de livrables (Drive + in-app).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth import resolve_tenant, require_admin
from database import dismiss_library_item
from services.deliverable_library import build_deliverables_library, resolve_library_group_id

router = APIRouter(tags=["deliverables"])


class LibraryDismissBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(..., min_length=1, max_length=2000)


@router.get("/deliverables/library", dependencies=[Depends(resolve_tenant)])
def deliverables_library_route(limit: int = Query(default=200, ge=1, le=400)):
    """Tous les livrables générés, regroupés par thématique."""
    return build_deliverables_library(limit=limit)


@router.post("/deliverables/library/dismiss", dependencies=[Depends(resolve_tenant)])
def deliverables_library_dismiss(body: LibraryDismissBody):
    """Retire un livrable de la bibliothèque sans supprimer le job source."""
    try:
        group_id = resolve_library_group_id(body.item_id)
        dismiss_library_item(group_id)
        return {"dismissed": True, "item_id": group_id}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
