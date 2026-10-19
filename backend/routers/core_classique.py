"""API partagée Classique + pont Google Agenda.

Classique (clé API, header `Authorization: Bearer <CLASSIQUE_API_KEY>`) :
  POST /classique/tasks             — déposer une tâche (enveloppe standard)
  GET  /classique/tasks/{id}        — polling statut / résultat
  POST /classique/tasks/{id}/result — Classique rend le résultat d'une tâche qui lui a été routée
  POST /classique/route             — prévisualiser le routage (aucune écriture)
  POST /classique/memory            — importer des fiches de conversation (mémoire vectorielle)
  GET  /classique/memory/search?q=  — extraits les plus proches (test de la mémoire)
  POST /classique/memory/reembed    — recalculer les vecteurs avec l'encodeur courant

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


class FicheIn(BaseModel):
    external_id: str = Field(min_length=1, max_length=191)
    title: str = Field(min_length=1, max_length=300)
    date: str = Field(default="", max_length=40)
    project: str = Field(default="", max_length=120)
    summary: str = Field(default="", max_length=8000)
    decisions: list[str] = Field(default_factory=list, max_length=50)
    actions: list[str] = Field(default_factory=list, max_length=50)
    source: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=30)


class MemoryImportIn(BaseModel):
    fiches: list[FicheIn] = Field(min_length=1, max_length=100)


class ReembedIn(BaseModel):
    only_conversations: bool = False
    limit: int = Field(default=5000, ge=1, le=100000)


_MEMORY_MAX_BYTES = 512 * 1024


class RouteIn(BaseModel):
    intent: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    category: str | None = None


class ResultIn(BaseModel):
    status: Literal["running", "completed", "failed", "cancelled"]
    result: Any = None
    error: str | None = None


@router.post("/classique/memory")
async def classique_memory_import(request: Request, auth: dict = Depends(require_classique)):
    from fastapi.concurrency import run_in_threadpool
    from pydantic import ValidationError

    from services.conversation_memory import import_fiches

    raw = await request.body()
    if len(raw) > _MEMORY_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Lot trop volumineux (512 Ko max).")
    try:
        body = MemoryImportIn.model_validate_json(raw or b"{}")
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False, include_context=False))
    for item in body.fiches:
        if len(item.model_dump_json()) > 16000:
            raise HTTPException(status_code=413, detail=f"Fiche trop longue : {item.external_id}")
    return await run_in_threadpool(import_fiches, [f.model_dump() for f in body.fiches])


@router.get("/classique/memory/search")
async def classique_memory_search(q: str, limit: int = 5, all_kinds: bool = False,
                                  auth: dict = Depends(require_classique)):
    from fastapi.concurrency import run_in_threadpool

    from services.conversation_memory import MEMORY_KIND
    from services.trace_vectors import embed_provider, search_trace_memory

    query = (q or "").strip()[:1000]
    if not query:
        raise HTTPException(status_code=422, detail="Paramètre q requis.")
    kinds = None if all_kinds else [MEMORY_KIND]
    rows = await run_in_threadpool(search_trace_memory, query, limit=max(1, min(limit, 8)), kinds=kinds)
    return {"provider": embed_provider() or None, "count": len(rows), "results": rows}


@router.post("/classique/memory/reembed")
async def classique_memory_reembed(body: ReembedIn | None = None, auth: dict = Depends(require_classique)):
    from fastapi.concurrency import run_in_threadpool

    from services.conversation_memory import MEMORY_KIND
    from services.trace_vectors import reembed_traces

    opts = body or ReembedIn()
    kinds = [MEMORY_KIND] if opts.only_conversations else None
    return await run_in_threadpool(reembed_traces, limit=opts.limit, kinds=kinds)


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
