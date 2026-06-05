"""Services dirigeant : inbox enrichie, briefing, notifications in-app."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from database import (
    get_hitl_gate,
    list_autonomous_outputs,
    list_director_notifications,
    list_jobs_summary,
    list_learning_suggestions,
    insert_director_notification,
)
from observability import event_payload
from runtime_sse import enqueue_job_sse_event


def _priority_score(kind: str) -> int:
    return {
        "hitl": 0,
        "cio_question": 1,
        "closure": 2,
        "learning_suggestion": 3,
        "scheduler_output": 4,
        "quality": 2,
    }.get(kind, 9)


def _hitl_kind_from_gate(gate: dict | None) -> str:
    if not gate or not isinstance(gate, dict):
        return "generic"
    inner = gate.get("gate") if isinstance(gate.get("gate"), dict) else gate
    kind = str(inner.get("kind") or "").strip()
    return kind if kind else "generic"


def _gate_preview(gate: dict | None) -> dict:
    if not gate:
        return {}
    inner = gate.get("gate") if isinstance(gate.get("gate"), dict) else gate
    plan = inner.get("plan_public") if isinstance(inner.get("plan_public"), dict) else {}
    agents = plan.get("agents") or []
    st = plan.get("sous_taches") if isinstance(plan.get("sous_taches"), dict) else {}
    return {
        "synthese_attendue": str(plan.get("synthese_attendue") or "")[:400],
        "agents": agents[:12] if isinstance(agents, list) else [],
        "sous_taches_count": len(st),
    }


def _parse_proposal_meta(content: str) -> dict:
    try:
        data = json.loads(content or "{}")
        if isinstance(data, dict):
            return {
                "why_now": str(data.get("why_now") or data.get("rationale") or "")[:500],
                "agents": data.get("agents") or [],
                "estimated_tokens": int(data.get("estimated_tokens") or 0),
                "estimated_cost_usd": float(data.get("estimated_cost_usd") or 0),
                "risk_flags": data.get("risk_flags") or [],
                "launch_mode": str(data.get("launch_mode") or "supervised"),
            }
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    return {}


def build_enriched_inbox(*, limit: int = 40, jobs: list[dict] | None = None) -> dict[str, Any]:
    items: list[dict] = []
    if jobs is None:
        jobs = list_jobs_summary(limit=limit * 2)
    for row in jobs:
        if str(row.get("source") or "") == "chat":
            continue
        jid = row.get("id")
        st = str(row.get("status") or "")
        if st == "awaiting_validation":
            gate = get_hitl_gate(jid) or {"gate": row.get("hitl_gate") or {}}
            hk = _hitl_kind_from_gate(gate)
            items.append({
                "kind": "hitl",
                "job_id": jid,
                "title": (row.get("mission") or "")[:160],
                "status": st,
                "updated_at": row.get("updated_at"),
                "hitl_kind": hk,
                "gate_preview": _gate_preview(gate),
                "priority_score": _priority_score("hitl"),
            })
        elif st == "completed" and not row.get("user_validated_at"):
            items.append({
                "kind": "closure",
                "job_id": jid,
                "title": (row.get("mission") or "")[:160],
                "status": st,
                "updated_at": row.get("updated_at"),
                "priority_score": _priority_score("closure"),
            })
        elif st == "quality_blocked":
            items.append({
                "kind": "quality",
                "job_id": jid,
                "title": (row.get("mission") or "")[:160],
                "status": st,
                "updated_at": row.get("updated_at"),
                "priority_score": _priority_score("quality"),
            })
        elif st == "running":
            pass
        pending_cio_questions: list[str] = []
        latest_cio_ts = None
        for ev in row.get("events") or []:
            if not isinstance(ev, dict) or ev.get("type") != "cio_question":
                continue
            pl = event_payload(ev)
            if pl.get("answered"):
                continue
            raw_qs = pl.get("questions") or []
            if not isinstance(raw_qs, list):
                continue
            for q in raw_qs:
                text = str(q).strip()
                if text and text not in pending_cio_questions:
                    pending_cio_questions.append(text)
            if ev.get("ts"):
                latest_cio_ts = ev.get("ts")
        if pending_cio_questions:
            mission = str(row.get("mission") or "").strip()
            first_q = pending_cio_questions[0]
            items.append({
                "kind": "cio_question",
                "job_id": jid,
                "title": (first_q or mission)[:200],
                "mission": mission[:160],
                "questions": pending_cio_questions,
                "updated_at": latest_cio_ts or row.get("updated_at"),
                "priority_score": _priority_score("cio_question"),
            })

    for sug in list_learning_suggestions(status="pending", limit=20):
        payload = sug.get("payload") if isinstance(sug.get("payload"), dict) else {}
        items.append({
            "kind": "learning_suggestion",
            "suggestion_id": sug.get("id"),
            "job_id": sug.get("job_id"),
            "title": str(payload.get("title") or "Suggestion d'apprentissage")[:160],
            "learnings": payload.get("learnings") or [],
            "updated_at": sug.get("created_at"),
            "priority_score": _priority_score("learning_suggestion"),
        })

    try:
        for out in list_autonomous_outputs(status="pending", limit=20):
            meta = _parse_proposal_meta(str(out.get("content") or ""))
            item = {
                "kind": "scheduler_output",
                "output_id": out.get("id"),
                "output_type": out.get("output_type"),
                "title": out.get("title") or out.get("output_type") or "Approbation",
                "status": out.get("status"),
                "updated_at": out.get("created_at"),
                "proposal_meta": meta,
                "estimated_cost_usd": meta.get("estimated_cost_usd", 0),
                "priority_score": _priority_score("scheduler_output"),
            }
            items.append(item)
    except Exception:
        pass

    items.sort(key=lambda x: (x.get("priority_score", 9), str(x.get("updated_at") or "")))
    return {"items": items[:limit], "total": len(items)}


def build_briefing(*, period: str = "today") -> dict[str, Any]:
    jobs = list_jobs_summary(limit=100)
    inbox = build_enriched_inbox(limit=50, jobs=jobs)
    running = [j for j in jobs if str(j.get("status") or "") == "running" and str(j.get("source") or "") != "chat"]
    hitl_pending = [j for j in jobs if str(j.get("status") or "") == "awaiting_validation"]
    closures = [i for i in inbox["items"] if i.get("kind") == "closure"]
    scheduler_pending = [i for i in inbox["items"] if i.get("kind") == "scheduler_output"]

    tokens_summary: dict[str, Any] = {}
    try:
        from routers.core_health import tokens_payload
        tokens_summary = tokens_payload()
    except Exception:
        tokens_summary = {}

    since = datetime.utcnow() - timedelta(days=1 if period == "today" else 7)
    analytics: dict[str, Any] = {"missions_total": 0, "missions_failed": 0, "missions_hitl_pending": len(hitl_pending)}
    try:
        from database import get_conn
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT status FROM jobs WHERE updated_at >= ?",
                (since.isoformat(),),
            ).fetchall()
        statuses = [str(dict(r).get("status") or "") for r in rows or []]
        analytics = {
            "missions_total": len(statuses),
            "missions_failed": sum(1 for s in statuses if s.startswith("error")),
            "missions_hitl_pending": len(hitl_pending),
        }
    except Exception:
        pass

    return {
        "period": period,
        "generated_at": datetime.utcnow().isoformat(),
        "decisions_today": inbox["items"][:5],
        "inbox_total": inbox["total"],
        "missions_running": [
            {"job_id": j.get("id"), "mission": (j.get("mission") or "")[:120], "agent": j.get("agent"), "updated_at": j.get("updated_at")}
            for j in running[:10]
        ],
        "hitl_pending_count": len(hitl_pending),
        "closures_pending_count": len(closures),
        "scheduler_pending_count": len(scheduler_pending),
        "budget": {
            "cost_today_usd": tokens_summary.get("cost_today_usd") or tokens_summary.get("cost_usd") or 0,
            "cost_week_usd": tokens_summary.get("cost_week_usd") or 0,
            "budget_exceeded": bool(tokens_summary.get("budget_exceeded")),
            "alert": bool(tokens_summary.get("alert")),
        },
        "analytics_24h": analytics,
        "notifications_unread": len(list_director_notifications(unread_only=True, limit=100)),
    }


def emit_director_notification(
    *,
    kind: str,
    title: str,
    body: str = "",
    job_id: str | None = None,
    output_id: str | None = None,
    action_url: str | None = None,
) -> dict:
    row = insert_director_notification(
        kind=kind,
        title=title,
        body=body,
        job_id=job_id,
        output_id=output_id,
        action_url=action_url,
    )
    enqueue_job_sse_event({
        "type": "director_notification",
        "kind": kind,
        "title": title,
        "body": body,
        "job_id": job_id,
        "output_id": output_id,
        "action_url": action_url,
        "id": row.get("id"),
        "ts": datetime.utcnow().isoformat(),
    })
    try:
        from services.notifications import dispatch_external_notification

        dispatch_external_notification(
            kind=kind,
            title=title,
            body=body,
            job_id=job_id,
            output_id=output_id,
            action_url=action_url,
        )
    except Exception:
        pass
    return row


def plan_diff(from_plan: dict, to_plan: dict) -> dict:
    """Diff structuré entre deux plans CIO."""
    fp = from_plan if isinstance(from_plan, dict) else {}
    tp = to_plan if isinstance(to_plan, dict) else {}
    fa = set(fp.get("agents") or []) if isinstance(fp.get("agents"), list) else set()
    ta = set(tp.get("agents") or []) if isinstance(tp.get("agents"), list) else set()
    fst = fp.get("sous_taches") if isinstance(fp.get("sous_taches"), dict) else {}
    tst = tp.get("sous_taches") if isinstance(tp.get("sous_taches"), dict) else {}
    changed_tasks = []
    for key in set(list(fst.keys()) + list(tst.keys())):
        if fst.get(key) != tst.get(key):
            changed_tasks.append({"key": key, "before": fst.get(key), "after": tst.get(key)})
    return {
        "agents_added": sorted(ta - fa),
        "agents_removed": sorted(fa - ta),
        "synthese_before": str(fp.get("synthese_attendue") or ""),
        "synthese_after": str(tp.get("synthese_attendue") or ""),
        "sous_taches_changed": changed_tasks,
    }
