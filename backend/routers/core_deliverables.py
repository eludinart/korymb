"""
routers/core_deliverables.py — Bibliothèque de livrables (Drive + in-app).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from auth import verify_secret
from services.deliverable_library import build_deliverables_library

router = APIRouter(tags=["deliverables"])


@router.get("/deliverables/library", dependencies=[Depends(verify_secret)])
def deliverables_library_route(limit: int = Query(default=200, ge=1, le=400)):
    """Tous les livrables générés, regroupés par thématique."""
    return build_deliverables_library(limit=limit)
