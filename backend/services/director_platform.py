"""Services dirigeant : inbox enrichie, briefing, notifications in-app."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from database import (
    _user_validated_set,
    get_hitl_gate,
    list_autonomous_outputs,
    list_director_notifications,
    list_jobs_summary,
    list_learning_suggestions,
    insert_director_notification,
    list_inbox_dismiss_keys,
    make_inbox_dismiss_key,
)
from observability import event_payload
from runtime_sse import enqueue_job_sse_event


def _priority_score(kind: str) -> int:
    return {
        "hitl": 0,
        "action_ticket": 0,
        "cio_question": 1,
        "mission_error": 1,
        "closure": 2,
        "learning_suggestion": 3,
        "scheduler_output": 4,
        "quality": 2,
    }.get(kind, 9)


def _sla_days(kind: str) -> int:
    """Délai cible (jours) avant considérer l'item en retard."""
    return {
        "hitl": 1,
        "action_ticket": 1,
        "cio_question": 2,
        "mission_error": 1,
        "closure": 3,
        "quality": 1,
        "learning_suggestion": 7,
        "scheduler_output": 2,
    }.get(kind, 3)


def _parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1]
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _days_open_since(iso_ts: str | None) -> int:
    dt = _parse_iso_dt(iso_ts)
    if not dt:
        return 0
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return max(0, (datetime.utcnow() - dt).days)


def _progress_label(kind: str) -> str:
    return {
        "hitl": "Validation dirigeant requise",
        "action_ticket": "Envoi réel — validation requise",
        "cio_question": "Réponse dirigeant attendue",
        "mission_error": "Mission en échec — à traiter ou clôturer",
        "closure": "Mission terminée — clôture en attente",
        "quality": "Contrôle qualité bloquant",
        "learning_suggestion": "Suggestion d'apprentissage à arbitrer",
        "scheduler_output": "Proposition autonome à approuver",
    }.get(kind, "Action requise")


def _is_chat_followup(row: dict) -> bool:
    """Suites CIO rattachées à une mission parent (évite le double affichage clôture)."""
    src = str(row.get("source") or "").strip().lower()
    if src != "chat":
        return False
    return bool(str(row.get("parent_job_id") or "").strip())


def _status_is_error(status: str) -> bool:
    return str(status or "").strip().lower().startswith("error")


def _urgency_level(days_open: int, sla_days: int) -> str:
    overdue = max(0, days_open - sla_days)
    if overdue >= 3:
        return "critical"
    if overdue >= 1 or days_open >= sla_days:
        return "warning"
    return "ok"


def _enrich_inbox_item(item: dict, *, job_row: dict | None = None) -> dict:
    kind = str(item.get("kind") or "")
    created_at = str(item.get("created_at") or item.get("updated_at") or "")
    days_open = _days_open_since(created_at)
    sla = _sla_days(kind)
    days_overdue = max(0, days_open - sla)
    priority_score = int(item.get("priority_score", 9))
    enriched = dict(item)
    enriched["created_at"] = created_at
    enriched["days_open"] = days_open
    enriched["sla_days"] = sla
    enriched["days_overdue"] = days_overdue
    enriched["urgency"] = _urgency_level(days_open, sla)
    enriched["progress_label"] = _progress_label(kind)
    enriched["priority_rank"] = priority_score + 1
    if job_row:
        enriched["job_created_at"] = job_row.get("created_at")
        if job_row.get("status") and not enriched.get("status"):
            enriched["status"] = job_row.get("status")
    return enriched


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
                "proposed_by_agent": str(data.get("proposed_by_agent") or ""),
                "source_kind": str(data.get("source_kind") or ""),
                "source_job_id": str(data.get("source_job_id") or ""),
                "source_label": str(data.get("source_label") or "")[:300],
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
    dismissed = list_inbox_dismiss_keys()
    if jobs is None:
        jobs = list_jobs_summary(limit=limit * 2)

    def _is_dismissed(item: dict) -> bool:
        try:
            key = make_inbox_dismiss_key(
                str(item.get("kind") or ""),
                job_id=item.get("job_id"),
                output_id=item.get("output_id"),
                suggestion_id=item.get("suggestion_id"),
                ticket_id=item.get("ticket_id"),
            )
            return key in dismissed
        except ValueError:
            return False

    for row in jobs:
        jid = row.get("id")
        st = str(row.get("status") or "")
        # Suites chat rattachées : HITL / questions CIO restent visibles, pas la clôture (le parent porte le rituel).
        skip_closure = _is_chat_followup(row)
        if st == "awaiting_validation":
            gate = get_hitl_gate(jid) or {"gate": row.get("hitl_gate") or {}}
            hk = _hitl_kind_from_gate(gate)
            items.append(_enrich_inbox_item({
                "kind": "hitl",
                "job_id": jid,
                "title": (row.get("mission") or "")[:160],
                "status": st,
                "created_at": row.get("updated_at"),
                "updated_at": row.get("updated_at"),
                "hitl_kind": hk,
                "primary_cta": "Valider et lancer" if hk == "cio_plan" else "Valider",
                "gate_preview": _gate_preview(gate),
                "priority_score": _priority_score("hitl"),
            }, job_row=row))
        elif st == "completed" and not _user_validated_set(row) and not skip_closure:
            items.append(_enrich_inbox_item({
                "kind": "closure",
                "job_id": jid,
                "title": (row.get("mission") or "")[:160],
                "status": st,
                "created_at": row.get("updated_at"),
                "updated_at": row.get("updated_at"),
                "priority_score": _priority_score("closure"),
                "source": row.get("source"),
            }, job_row=row))
        elif _status_is_error(st) and not _user_validated_set(row) and not skip_closure:
            err_detail = st[6:].strip() if st.lower().startswith("error:") else st
            mission = str(row.get("mission") or "").strip()
            items.append(_enrich_inbox_item({
                "kind": "mission_error",
                "job_id": jid,
                "title": (err_detail or mission or "Mission en échec")[:200],
                "mission": mission[:160],
                "status": st,
                "created_at": row.get("updated_at"),
                "updated_at": row.get("updated_at"),
                "priority_score": _priority_score("mission_error"),
                "source": row.get("source"),
            }, job_row=row))
        elif st == "quality_blocked":
            items.append(_enrich_inbox_item({
                "kind": "quality",
                "job_id": jid,
                "title": (row.get("mission") or "")[:160],
                "status": st,
                "created_at": row.get("updated_at"),
                "updated_at": row.get("updated_at"),
                "priority_score": _priority_score("quality"),
            }, job_row=row))
        elif st == "running":
            pass
        pending_cio_questions: list[str] = []
        latest_cio_ts = None
        for ev in row.get("events") or []:
            if not isinstance(ev, dict) or ev.get("type") != "cio_question":
                continue
            pl = event_payload(ev)
            if pl.get("answered") or pl.get("dismissed"):
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
            cio_created = latest_cio_ts or row.get("updated_at")
            items.append(_enrich_inbox_item({
                "kind": "cio_question",
                "job_id": jid,
                "title": (first_q or mission)[:200],
                "mission": mission[:160],
                "questions": pending_cio_questions,
                "created_at": cio_created,
                "updated_at": cio_created,
                "priority_score": _priority_score("cio_question"),
            }, job_row=row))

    for sug in list_learning_suggestions(status="pending", limit=20):
        payload = sug.get("payload") if isinstance(sug.get("payload"), dict) else {}
        items.append(_enrich_inbox_item({
            "kind": "learning_suggestion",
            "suggestion_id": sug.get("id"),
            "job_id": sug.get("job_id"),
            "title": str(payload.get("title") or "Suggestion d'apprentissage")[:160],
            "learnings": payload.get("learnings") or [],
            "created_at": sug.get("created_at"),
            "updated_at": sug.get("created_at"),
            "priority_score": _priority_score("learning_suggestion"),
        }))

    try:
        from services.action_queue import list_actions

        for ticket in list_actions(status="pending", limit=40):
            payload = ticket.get("payload") if isinstance(ticket.get("payload"), dict) else {}
            action_kind = str(ticket.get("kind") or "")
            contact_id = str(payload.get("contact_id") or "").strip() or None
            items.append(_enrich_inbox_item({
                "kind": "action_ticket",
                "ticket_id": ticket.get("id"),
                "job_id": ticket.get("job_id") or None,
                "action_kind": action_kind,
                "title": ticket.get("title") or "Action à valider",
                "summary": ticket.get("summary") or "",
                "preview_url": ticket.get("preview_url") or None,
                "payload": payload,
                "contact_id": contact_id,
                "primary_cta": (
                    "Approuver et envoyer"
                    if action_kind == "email"
                    else "Valider et créer"
                    if action_kind == "calendar"
                    else "Valider et publier"
                    if action_kind in ("wordpress", "social")
                    else "Valider"
                ),
                "status": ticket.get("status"),
                "created_at": ticket.get("created_at"),
                "updated_at": ticket.get("updated_at"),
                "priority_score": _priority_score("action_ticket"),
            }))
    except Exception:
        pass

    try:
        for out in list_autonomous_outputs(status="pending", limit=20):
            meta = _parse_proposal_meta(str(out.get("content") or ""))
            item = _enrich_inbox_item({
                "kind": "scheduler_output",
                "output_id": out.get("id"),
                "output_type": out.get("output_type"),
                "title": out.get("title") or out.get("output_type") or "Approbation",
                "status": out.get("status"),
                "created_at": out.get("created_at"),
                "updated_at": out.get("created_at"),
                "proposal_meta": meta,
                "estimated_cost_usd": meta.get("estimated_cost_usd", 0),
                "priority_score": _priority_score("scheduler_output"),
            })
            items.append(item)
    except Exception:
        pass

    items.sort(key=lambda x: (x.get("priority_score", 9), str(x.get("updated_at") or "")))
    visible = [i for i in items if not _is_dismissed(i)]
    return {"items": visible[:limit], "total": len(visible)}


def _priority_label(item: dict) -> str:
    kind = str(item.get("kind") or "")
    title = str(item.get("title") or item.get("mission") or "").strip()
    if kind == "action_ticket":
        return f"Valider l'envoi — {title[:80]}" if title else "Valider une action préparée"
    if kind == "hitl":
        hk = str(item.get("hitl_kind") or "")
        if hk == "cio_plan":
            return f"Valider le plan CIO — {title[:80]}" if title else "Valider le plan CIO"
        return f"Validation requise — {title[:80]}" if title else "Validation dirigeant requise"
    if kind == "cio_question":
        return title[:120] if title else "Répondre au CIO"
    if kind == "mission_error":
        return f"Échec mission — {title[:80]}" if title else "Mission en échec"
    if kind == "closure":
        return f"Clôturer la mission — {title[:80]}" if title else "Clôturer une mission terminée"
    if kind == "scheduler_output":
        return f"Approuver — {title[:80]}" if title else "Approuver une proposition autonome"
    if kind == "learning_suggestion":
        return title[:120] if title else "Arbitrer une suggestion d'apprentissage"
    if kind == "quality":
        return f"Débloquer la qualité — {title[:80]}" if title else "Contrôle qualité bloquant"
    return title[:120] if title else "Action requise"


def _priority_href(item: dict) -> str:
    kind = str(item.get("kind") or "")
    tid = str(item.get("ticket_id") or "").strip()
    jid = str(item.get("job_id") or "").strip()
    oid = str(item.get("output_id") or "").strip()
    sid = str(item.get("suggestion_id") or "").strip()
    focus = tid or jid or oid or sid
    if focus:
        return f"/inbox?triage=1&focus={focus}"
    return "/inbox?triage=1"


def _build_top_priorities(inbox_items: list[dict], *, limit: int = 3) -> list[dict]:
    out: list[dict] = []
    for item in inbox_items[:limit]:
        out.append({
            "id": str(item.get("ticket_id") or item.get("job_id") or item.get("output_id") or item.get("suggestion_id") or len(out)),
            "label": _priority_label(item),
            "href": _priority_href(item),
            "kind": item.get("kind"),
            "urgency": item.get("urgency"),
            "job_id": item.get("job_id"),
        })
    return out


def _memory_highlights(limit: int = 3) -> list[dict]:
    try:
        from database import get_enterprise_memory

        mem = get_enterprise_memory()
        contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
        keys_order = ["global", "commercial", "community_manager", "developpeur", "comptable", "coordinateur"]
        labels = {
            "global": "Contexte global",
            "commercial": "Commercial",
            "community_manager": "Community",
            "developpeur": "Développeur",
            "comptable": "Comptable",
            "coordinateur": "CIO",
        }
        highlights: list[dict] = []
        for key in keys_order:
            text = str(contexts.get(key) or "").strip()
            if not text:
                continue
            snippet = text.replace("\n", " ").strip()
            if len(snippet) > 140:
                snippet = snippet[:137] + "…"
            highlights.append({
                "key": key,
                "label": labels.get(key, key),
                "snippet": snippet,
            })
            if len(highlights) >= limit:
                break
        return highlights
    except Exception:
        return []


def _build_executive_summary(
    *,
    inbox_total: int,
    hitl_count: int,
    running_count: int,
    budget: dict,
    analytics: dict,
) -> str:
    parts: list[str] = []
    if inbox_total > 0:
        dec = f"{inbox_total} décision{'s' if inbox_total > 1 else ''} en attente"
        if hitl_count > 0:
            dec += f" ({hitl_count} validation{'s' if hitl_count > 1 else ''} HITL)"
        parts.append(dec + " bloquent l'avancement")
    elif running_count > 0:
        parts.append(f"Journée dégagée — {running_count} mission{'s' if running_count > 1 else ''} en cours")
    else:
        parts.append("Aucune action urgente — votre file est vide")

    if budget.get("budget_exceeded"):
        parts.append("budget journalier dépassé")
    elif budget.get("alert"):
        parts.append("alerte budget — prudence avant de lancer")

    failed = int(analytics.get("missions_failed") or 0)
    if failed > 0:
        parts.append(f"{failed} mission{'s' if failed > 1 else ''} en échec sur la période")

    if len(parts) == 1 and not budget.get("budget_exceeded") and not budget.get("alert"):
        cost_week = float(budget.get("cost_week_usd") or 0)
        if cost_week > 0:
            parts.append(f"budget semaine à ${cost_week:.2f}")

    if not parts:
        return "Votre cockpit est prêt."
    first = parts[0]
    if len(parts) == 1:
        return first[0].upper() + first[1:] + "."
    return (first[0].upper() + first[1:]) + " ; " + " ; ".join(parts[1:]) + "."


def _ritual_status(inbox_total: int, budget: dict) -> str:
    if budget.get("budget_exceeded"):
        return "budget_alert"
    if inbox_total > 0:
        return "decisions_needed"
    return "clear"


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

    budget_block = {
        "cost_today_usd": tokens_summary.get("cost_today_usd") or tokens_summary.get("cost_usd") or 0,
        "cost_week_usd": tokens_summary.get("cost_week_usd") or 0,
        "budget_exceeded": bool(tokens_summary.get("budget_exceeded")),
        "alert": bool(tokens_summary.get("alert")),
    }
    executive_summary = _build_executive_summary(
        inbox_total=inbox["total"],
        hitl_count=len(hitl_pending),
        running_count=len(running),
        budget=budget_block,
        analytics=analytics,
    )

    return {
        "period": period,
        "generated_at": datetime.utcnow().isoformat(),
        "executive_summary": executive_summary,
        "top_priorities": _build_top_priorities(inbox["items"]),
        "memory_highlights": _memory_highlights(),
        "ritual_status": _ritual_status(inbox["total"], budget_block),
        "decisions_today": inbox["items"][:5],
        "inbox_total": inbox["total"],
        "missions_running": [
            {"job_id": j.get("id"), "mission": (j.get("mission") or "")[:120], "agent": j.get("agent"), "updated_at": j.get("updated_at")}
            for j in running[:10]
        ],
        "hitl_pending_count": len(hitl_pending),
        "closures_pending_count": len(closures),
        "scheduler_pending_count": len(scheduler_pending),
        "budget": budget_block,
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
