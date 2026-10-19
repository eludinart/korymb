"""Admin : lancer un robot Apify (Actor), suivre son statut, lire ses résultats.

Sans état : rien n'est écrit en base, tout est relu depuis Apify.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth import require_admin
from services import apify_client as apify

router = APIRouter(tags=["admin-apify"], dependencies=[Depends(require_admin)])

_RUN_ID = re.compile(r"^[A-Za-z0-9]{1,64}$")


class ApifyRunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_id: str = Field("", max_length=200)
    input: dict[str, Any] = Field(default_factory=dict)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except apify.ApifyNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except apify.ApifyError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _check_run_id(run_id: str) -> str:
    if not _RUN_ID.match(run_id or ""):
        raise HTTPException(status_code=400, detail="run_id invalide")
    return run_id


@router.get("/admin/apify/status")
def apify_status():
    return apify.apify_status()


@router.post("/admin/apify/runs")
def apify_start_run(body: ApifyRunBody):
    return {"run": _call(apify.start_run, body.actor_id, body.input)}


@router.get("/admin/apify/runs")
def apify_list_runs(limit: int = Query(20, ge=1, le=100)):
    return {"items": _call(apify.list_runs, limit)}


@router.get("/admin/apify/runs/{run_id}")
def apify_get_run(run_id: str):
    return {"run": _call(apify.get_run, _check_run_id(run_id))}


@router.get("/admin/apify/runs/{run_id}/results")
def apify_run_results(run_id: str, limit: int = Query(100, ge=1, le=1000)):
    return _call(apify.get_results, _check_run_id(run_id), limit)
