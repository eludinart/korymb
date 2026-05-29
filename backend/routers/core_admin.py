"""Admin : inbox dirigeant, briefing, notifications, analytics."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from database import (
    get_conn,
    get_learning_suggestion,
    list_director_notifications,
    mark_all_director_notifications_read,
    mark_director_notification_read,
    resolve_learning_suggestion,
)
from services.director_platform import build_briefing, build_enriched_inbox

router = APIRouter(tags=["admin-platform"])


class LearningResolveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: str = Field(pattern="^(approve|reject)$")


@router.get("/admin/inbox", dependencies=[Depends(verify_secret)])
def admin_inbox(limit: int = Query(40, ge=1, le=200)):
    return build_enriched_inbox(limit=limit)


@router.get("/admin/briefing", dependencies=[Depends(verify_secret)])
def admin_briefing(period: str = Query("today")):
    return build_briefing(period=period)


@router.get("/admin/notifications", dependencies=[Depends(verify_secret)])
def admin_notifications(unread_only: bool = Query(False), limit: int = Query(50, ge=1, le=200)):
    rows = list_director_notifications(unread_only=unread_only, limit=limit)
    return {"items": rows, "total": len(rows)}


@router.patch("/admin/notifications/{notif_id}/read", dependencies=[Depends(verify_secret)])
def admin_notification_mark_read(notif_id: str):
    row = mark_director_notification_read(notif_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification introuvable.")
    return row


@router.post("/admin/notifications/mark-all-read", dependencies=[Depends(verify_secret)])
def admin_notifications_mark_all_read():
    n = mark_all_director_notifications_read()
    return {"marked": n}


@router.post("/admin/learning-suggestions/{suggestion_id}/resolve", dependencies=[Depends(verify_secret)])
def admin_learning_suggestion_resolve(suggestion_id: str, body: LearningResolveBody):
    sug = get_learning_suggestion(suggestion_id)
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion introuvable.")
    if body.decision == "approve":
        payload = sug.get("payload") if isinstance(sug.get("payload"), dict) else {}
        memory_updates = payload.get("suggested_memory_keys") if isinstance(payload.get("suggested_memory_keys"), dict) else {}
        if memory_updates:
            try:
                from database import merge_enterprise_contexts, snapshot_memory_history
                snapshot_memory_history(comment="auto — learning suggestion approved")
                merge_enterprise_contexts({str(k): str(v).strip() for k, v in memory_updates.items() if str(v).strip()})
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"Impossible d'appliquer la mémoire : {exc}") from exc
        resolve_learning_suggestion(suggestion_id, "approved")
    else:
        resolve_learning_suggestion(suggestion_id, "rejected")
    return get_learning_suggestion(suggestion_id)


@router.get("/admin/mission-analytics", dependencies=[Depends(verify_secret)])
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
