"""Admin : inbox dirigeant, briefing, notifications, analytics."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from auth import resolve_tenant, require_admin
from database import (
    JOB_ID_MAX_LEN,
    get_conn,
    get_learning_suggestion,
    dismiss_inbox_item,
    list_director_notifications,
    mark_all_director_notifications_read,
    mark_director_notification_read,
    delete_director_notification,
    resolve_learning_suggestion,
)
from services.director_platform import build_briefing, build_enriched_inbox

router = APIRouter(tags=["admin-platform"])


class LearningResolveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: str = Field(pattern="^(approve|reject)$")


class InboxDismissBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = Field(..., min_length=1, max_length=32)
    job_id: str | None = Field(None, max_length=JOB_ID_MAX_LEN)
    output_id: str | None = Field(None, max_length=64)
    suggestion_id: str | None = Field(None, max_length=64)
    ticket_id: str | None = Field(None, max_length=64)

    @field_validator("job_id", mode="before")
    @classmethod
    def _normalize_job_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()[:JOB_ID_MAX_LEN]
        return normalized or None


class RepriseAuditBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nb_proposals: int = Field(5, ge=1, le=10)
    generate_proposals: bool = True


class RepriseItemActionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain_id: str = Field(..., min_length=1, max_length=80)
    item_text: str = Field(..., min_length=1, max_length=500)
    action: str = Field(..., pattern="^(validated|noted|deferred|ignored)$")
    note: str = Field("", max_length=4000)


class RepriseItemReopenBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain_id: str = Field(..., min_length=1, max_length=80)
    item_text: str = Field(..., min_length=1, max_length=500)


class RepriseChecklistItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain_id: str = Field(..., min_length=1, max_length=80)
    item_text: str = Field(..., min_length=1, max_length=500)
    note: str = Field("", max_length=4000)


class RepriseItemsMissionsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[RepriseChecklistItem] = Field(..., min_length=1, max_length=10)


class RepriseItemsLaunchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[RepriseChecklistItem] = Field(..., min_length=1, max_length=5)
    launch_mode: str = Field("supervised", pattern="^(supervised|autonomous)$")


@router.get("/admin/reprise/coverage", dependencies=[Depends(require_admin)])
def admin_reprise_coverage():
    """Scan checklist reprise vs mémoire/missions — sans appel LLM."""
    from services.reprise_audit import scan_reprise_coverage

    _require_database_or_503()
    return scan_reprise_coverage()


@router.get("/admin/reprise/actions", dependencies=[Depends(require_admin)])
def admin_reprise_actions():
    from database import list_reprise_checklist_actions

    return {"actions": list_reprise_checklist_actions()}


@router.post("/admin/reprise/actions", dependencies=[Depends(require_admin)])
def admin_reprise_record_action(body: RepriseItemActionBody):
    """Valide, note ou reporte un point checklist — enrichit la mémoire entreprise."""
    from services.reprise_audit import record_reprise_item_action

    try:
        return record_reprise_item_action(
            domain_id=body.domain_id,
            item_text=body.item_text,
            action=body.action,
            note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/admin/reprise/actions/reopen", dependencies=[Depends(require_admin)])
def admin_reprise_reopen_item(body: RepriseItemReopenBody):
    """Réaffiche un point checklist ignoré ou reporté."""
    from services.reprise_audit import reopen_reprise_item

    try:
        return reopen_reprise_item(domain_id=body.domain_id, item_text=body.item_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/admin/reprise/items/missions", dependencies=[Depends(require_admin)])
def admin_reprise_items_missions(body: RepriseItemsMissionsBody):
    """Transforme des points checklist sélectionnés en propositions de mission."""
    from services.reprise_audit import create_missions_from_checklist_items

    try:
        payload = [i.model_dump() for i in body.items]
        return create_missions_from_checklist_items(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/admin/reprise/items/launch", dependencies=[Depends(require_admin)])
async def admin_reprise_items_launch(body: RepriseItemsLaunchBody):
    """Lance les agents immédiatement et alimente contexte global + volets métiers."""
    from services.reprise_audit import launch_agents_from_checklist_items

    try:
        payload = [i.model_dump() for i in body.items]
        return await launch_agents_from_checklist_items(payload, launch_mode=body.launch_mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/admin/reprise/audit", dependencies=[Depends(require_admin)])
async def admin_reprise_audit(body: RepriseAuditBody):
    """Scan reprise + génération de missions concrètes pour les lacunes."""
    from services.reprise_audit import run_reprise_audit

    result = await run_reprise_audit(
        nb_proposals=body.nb_proposals,
        generate_proposals=body.generate_proposals,
    )
    return result


@router.get("/admin/inbox", dependencies=[Depends(require_admin)])
def admin_inbox(limit: int = Query(80, ge=1, le=200)):
    return build_enriched_inbox(limit=limit)


@router.post("/admin/inbox/dismiss", dependencies=[Depends(require_admin)])
def admin_inbox_dismiss(body: InboxDismissBody):
    try:
        return dismiss_inbox_item(
            body.kind,
            job_id=body.job_id,
            output_id=body.output_id,
            suggestion_id=body.suggestion_id,
            ticket_id=body.ticket_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class InboxBulkCloseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kinds: list[str] = Field(default_factory=lambda: ["closure", "mission_error"])
    limit: int = Field(100, ge=1, le=200)


@router.post("/admin/inbox/close-bulk", dependencies=[Depends(require_admin)])
def admin_inbox_close_bulk(body: InboxBulkCloseBody):
    """Clôture en masse les clôtures / échecs encore ouverts dans l'inbox."""
    from database import job_close_mission_by_user, job_set_user_validated

    wanted = {str(k).strip() for k in (body.kinds or []) if str(k).strip()}
    if not wanted:
        wanted = {"closure", "mission_error"}
    inbox = build_enriched_inbox(limit=body.limit)
    closed: list[str] = []
    skipped: list[str] = []
    for item in inbox.get("items") or []:
        kind = str(item.get("kind") or "")
        jid = str(item.get("job_id") or "").strip()
        if kind not in wanted or not jid:
            continue
        ok = False
        if kind == "closure":
            ok = job_set_user_validated(jid)
        elif kind == "mission_error":
            ok = job_close_mission_by_user(jid)
        if ok:
            closed.append(jid)
        else:
            skipped.append(jid)
    return {
        "ok": True,
        "closed": closed,
        "closed_count": len(closed),
        "skipped": skipped,
        "skipped_count": len(skipped),
    }


def _require_database_or_503() -> None:
    from database import probe_database_connection

    probe = probe_database_connection()
    if not probe.get("connected"):
        raise HTTPException(
            status_code=503,
            detail=f"mariadb_tunnel_required: {probe.get('detail') or 'tunnel MariaDB requis (port 3307)'}",
        )


@router.get("/admin/briefing", dependencies=[Depends(require_admin)])
def admin_briefing(period: str = Query("today")):
    _require_database_or_503()
    return build_briefing(period=period)


@router.get("/admin/notifications", dependencies=[Depends(require_admin)])
def admin_notifications(unread_only: bool = Query(False), limit: int = Query(50, ge=1, le=200)):
    rows = list_director_notifications(unread_only=unread_only, limit=limit)
    return {"items": rows, "total": len(rows)}


@router.patch("/admin/notifications/{notif_id}/read", dependencies=[Depends(require_admin)])
def admin_notification_mark_read(notif_id: str):
    row = mark_director_notification_read(notif_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification introuvable.")
    return row


@router.post("/admin/notifications/mark-all-read", dependencies=[Depends(require_admin)])
def admin_notifications_mark_all_read():
    n = mark_all_director_notifications_read()
    return {"marked": n}


@router.delete("/admin/notifications/{notif_id}", dependencies=[Depends(require_admin)])
def admin_notification_delete(notif_id: str):
    if not delete_director_notification(notif_id):
        raise HTTPException(status_code=404, detail="Notification introuvable.")
    return {"deleted": notif_id}


@router.post("/admin/learning-suggestions/{suggestion_id}/resolve", dependencies=[Depends(require_admin)])
def admin_learning_suggestion_resolve(suggestion_id: str, body: LearningResolveBody):
    sug = get_learning_suggestion(suggestion_id)
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion introuvable.")
    if body.decision == "approve":
        payload = sug.get("payload") if isinstance(sug.get("payload"), dict) else {}
        memory_updates = payload.get("suggested_memory_keys") if isinstance(payload.get("suggested_memory_keys"), dict) else {}
        if memory_updates:
            try:
                from services.learning import apply_learning_payload_to_memory

                apply_learning_payload_to_memory(
                    payload if isinstance(payload, dict) else {},
                    snapshot_comment="auto — learning suggestion approved",
                )
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Impossible d'appliquer la mémoire : {exc}") from exc
        resolve_learning_suggestion(suggestion_id, "approved")
    else:
        resolve_learning_suggestion(suggestion_id, "rejected")
    return get_learning_suggestion(suggestion_id)


@router.get("/admin/mission-analytics", dependencies=[Depends(require_admin)])
def admin_mission_analytics(days: int = Query(7, ge=1, le=90)):
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT status, tokens_in, tokens_out, updated_at FROM jobs WHERE updated_at >= ?",
            (since,),
        ).fetchall()
        trace_rows = conn.execute(
            "SELECT job_id, cost_usd, latency_ms, graph_node, agent FROM mission_traces WHERE created_at >= ?",
            (since,),
        ).fetchall()

    jobs = [dict(r) for r in rows]
    total = len(jobs)
    failed = sum(1 for j in jobs if str(j.get("status") or "").startswith("error"))
    hitl = sum(1 for j in jobs if str(j.get("status") or "") == "awaiting_validation")
    tokens_in = sum(int(j.get("tokens_in") or 0) for j in jobs)
    tokens_out = sum(int(j.get("tokens_out") or 0) for j in jobs)
    traces = [dict(r) for r in trace_rows]
    cost = round(sum(float(t.get("cost_usd") or 0) for t in traces), 4)
    avg_latency = 0
    if traces:
        avg_latency = int(sum(int(t.get("latency_ms") or 0) for t in traces) / len(traces))

    return {
        "days": days,
        "missions_total": total,
        "missions_failed": failed,
        "missions_hitl_pending": hitl,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "trace_cost_usd": cost,
        "avg_trace_latency_ms": avg_latency,
        "failure_rate": round(failed / total, 4) if total else 0,
    }
