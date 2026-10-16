"""API partagée Classique + pont Google Agenda.

Classique (clé API, header `Authorization: Bearer <CLASSIQUE_API_KEY>`) :
  POST /classique/tasks             — déposer une tâche (enveloppe standard)
  GET  /classique/tasks/{id}        — polling statut / résultat
  POST /classique/tasks/{id}/result — Classique rend le résultat d'une tâche qui lui a été routée
  POST /classique/route             — prévisualiser le routage (aucune écriture)

Opérateur (session admin Korymb) :
  GET  /classique/identity          — fiche Classique + état de config
  GET  /classique/admin/tasks       — file des tâches (UI administration)
  POST /classique/admin/tasks/{id}  — clôturer une tâche côté Korymb / Eric
  GET  /calendar-sync/status        — état du pont agenda
  POST /calendar-sync/run           — synchro manuelle
  GET  /calendar-sync/conflicts     — conflits ouverts
  POST /calendar-sync/conflicts/{id}/resolve
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, HttpUrl

from services import calendar_sync
from services import classique_bridge as bridge
from services.classique_router import route
from services.workspace_auth import require_operator
from tenant_context import set_tenant_context

router = APIRouter(tags=["classique"])


async def require_classique(request: Request) -> dict[str, Any]:
    if not bridge.is_configured():
        raise HTTPException(status_code=503, detail="Intégration Classique non configurée (CLASSIQUE_API_KEY).")
    header = request.headers.get("Authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not bridge.verify_api_key(token):
        raise HTTPException(status_code=401, detail="Clé Classique invalide.")
    ws = (request.headers.get("X-Workspace-Id") or "").strip() or bridge.default_workspace_id()
    set_tenant_context(workspace_id=ws)
    return {"mode": "classique", "workspace_id": ws}


class TaskIn(BaseModel):
    intent: str = Field(min_length=1, max_length=500)
    payload: dict[str, Any] = Field(default_factory=dict)
    category: str | None = Field(default=None, description="business | personal_technical | mixed | undetermined")
    callback_url: HttpUrl | None = None
    external_id: str | None = Field(default=None, max_length=191)
    workspace: str | None = None


class RouteIn(BaseModel):
    intent: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    category: str | None = None


class ResultIn(BaseModel):
    status: Literal["running", "completed", "failed", "cancelled"]
    result: Any = None
    error: str | None = None


@router.post("/classique/route")
async def classique_route(body: RouteIn, auth: dict = Depends(require_classique)):
    return route(category=body.category, intent=body.intent, payload=body.payload)


@router.post("/classique/tasks", status_code=202)
async def classique_create_task(body: TaskIn, auth: dict = Depends(require_classique)):
    ws = body.workspace or auth["workspace_id"]
    task = bridge.create_task(
        workspace_id=ws, intent=body.intent, payload=body.payload, category=body.category,
        callback_url=str(body.callback_url) if body.callback_url else None, external_id=body.external_id,
    )
    env = bridge.public_envelope(task)
    env["poll_url"] = f"/classique/tasks/{task['id']}"
    return env


@router.get("/classique/tasks/{task_id}")
async def classique_get_task(task_id: str, auth: dict = Depends(require_classique)):
    task = bridge.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    return bridge.public_envelope(task)


@router.post("/classique/tasks/{task_id}/result")
async def classique_post_result(task_id: str, body: ResultIn, auth: dict = Depends(require_classique)):
    task = bridge.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    if task["target"] not in ("classique", "concertation"):
        raise HTTPException(status_code=409, detail="Cette tâche n'est pas confiée à Classique.")
    try:
        task = bridge.update_task(task_id, status=body.status, result=body.result, error=body.error)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return bridge.public_envelope(task or {})


# ── Opérateur ────────────────────────────────────────────────────────────────

@router.get("/classique/identity")
async def classique_identity(auth: dict = Depends(require_operator)):
    ws = str(auth.get("workspace_id") or "")
    return {
        **bridge.CLASSIQUE_IDENTITY,
        "configured": bridge.is_configured(),
        "webhook_signing": bool(bridge._webhook_secret()),
        "task_counts": bridge.stats(ws or None),
        "calendar_sync": {"enabled": calendar_sync.is_enabled(), "interval_min": calendar_sync.interval_minutes()},
    }


@router.get("/classique/admin/tasks")
async def classique_admin_tasks(status: str | None = None, limit: int = 50, auth: dict = Depends(require_operator)):
    ws = str(auth.get("workspace_id") or "") or None
    return {"tasks": [bridge.public_envelope(t) for t in bridge.list_tasks(workspace_id=ws, status=status, limit=limit)]}


@router.post("/classique/admin/tasks/{task_id}")
async def classique_admin_update(task_id: str, body: ResultIn, auth: dict = Depends(require_operator)):
    ws = str(auth.get("workspace_id") or "") or None
    try:
        task = bridge.update_task(task_id, workspace_id=ws, status=body.status, result=body.result, error=body.error)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    return bridge.public_envelope(task)


@router.get("/calendar-sync/status")
async def calendar_sync_status(auth: dict = Depends(require_operator)):
    ws = calendar_sync.sync_workspace_id()
    return {
        "enabled": calendar_sync.is_enabled(),
        "interval_min": calendar_sync.interval_minutes(),
        "workspace_id": ws,
        "calendar_id": calendar_sync.calendar_id(),
        "last_run": calendar_sync.last_run(ws),
        "open_conflicts": len(calendar_sync.list_conflicts(ws)),
    }


@router.post("/calendar-sync/run")
async def calendar_sync_run(auth: dict = Depends(require_operator)):
    if not calendar_sync.is_enabled():
        raise HTTPException(status_code=409, detail="Synchro agenda désactivée (KORYMB_GCAL_SYNC_ENABLED).")
    try:
        return {"ok": True, "summary": calendar_sync.run_sync(trigger="manual")}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.get("/calendar-sync/conflicts")
async def calendar_sync_conflicts(auth: dict = Depends(require_operator)):
    return {"conflicts": calendar_sync.list_conflicts(calendar_sync.sync_workspace_id())}


class ConflictResolveIn(BaseModel):
    resolution: Literal["resolved", "dismissed"] = "resolved"


@router.post("/calendar-sync/conflicts/{conflict_id}/resolve")
async def calendar_sync_resolve(conflict_id: str, body: ConflictResolveIn, auth: dict = Depends(require_operator)):
    if not calendar_sync.resolve_conflict(calendar_sync.sync_workspace_id(), conflict_id, body.resolution):
        raise HTTPException(status_code=404, detail="Conflit introuvable ou déjà traité.")
    return {"ok": True}
