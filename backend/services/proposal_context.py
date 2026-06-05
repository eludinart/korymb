"""Agrégation du contexte écosystème pour les propositions de missions CIO."""
from __future__ import annotations

import json
from typing import Any

from database import (
    get_enterprise_memory,
    list_jobs_prompt_digest,
    list_jobs_thread_digest,
    list_learning_suggestions,
)
from services.director_platform import build_enriched_inbox


def _truncate(text: str, max_len: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _compact_inbox_item(item: dict) -> dict:
    kind = str(item.get("kind") or "")
    out: dict[str, Any] = {
        "kind": kind,
        "title": _truncate(str(item.get("title") or ""), 200),
        "job_id": item.get("job_id") or item.get("output_id") or item.get("suggestion_id"),
    }
    if kind == "cio_question":
        qs = item.get("questions") or []
        if isinstance(qs, list):
            out["questions"] = [_truncate(str(q), 180) for q in qs[:4]]
    if kind == "learning_suggestion":
        learnings = item.get("learnings") or []
        if isinstance(learnings, list):
            out["learnings"] = [_truncate(str(x), 120) for x in learnings[:3]]
    if kind == "hitl":
        out["hitl_kind"] = item.get("hitl_kind")
        gp = item.get("gate_preview") if isinstance(item.get("gate_preview"), dict) else {}
        out["synthese"] = _truncate(str(gp.get("synthese_attendue") or ""), 200)
    return out


def build_ecosystem_proposal_context(*, max_chars: int = 12_000) -> dict[str, Any]:
    memory = get_enterprise_memory()
    inbox = build_enriched_inbox(limit=25)
    pending = [
        _compact_inbox_item(i)
        for i in (inbox.get("items") or [])
        if isinstance(i, dict) and str(i.get("kind") or "") != "scheduler_output"
    ]

    learn_rows = list_learning_suggestions(status="pending", limit=5)
    learning_pending = []
    for row in learn_rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        learning_pending.append({
            "suggestion_id": row.get("id"),
            "job_id": row.get("job_id"),
            "title": _truncate(str(payload.get("title") or ""), 160),
            "learnings": [
                _truncate(str(x), 120)
                for x in (payload.get("learnings") or [])[:3]
                if str(x).strip()
            ],
        })

    return {
        "memory_contexts": memory.get("contexts") or {},
        "recent_missions": memory.get("recent_missions") or [],
        "pending_decisions": pending,
        "missions_digest": list_jobs_prompt_digest(limit=8),
        "thread_excerpts": list_jobs_thread_digest(limit=5),
        "learning_pending": learning_pending,
        "max_chars": max_chars,
    }


def format_context_for_prompt(ctx: dict[str, Any]) -> str:
    max_chars = int(ctx.get("max_chars") or 12_000)
    sections: list[str] = []

    contexts = ctx.get("memory_contexts") if isinstance(ctx.get("memory_contexts"), dict) else {}
    if contexts:
        lines = []
        for k, v in contexts.items():
            if str(v or "").strip():
                lines.append(f"### {k}\n{_truncate(str(v), 1200)}")
        if lines:
            sections.append("## 1. Mémoire entreprise\n" + "\n\n".join(lines))

    recent = ctx.get("recent_missions") if isinstance(ctx.get("recent_missions"), list) else []
    if recent:
        rlines = []
        for r in recent[-6:]:
            if not isinstance(r, dict):
                continue
            rlines.append(
                f"- [#{r.get('job_id', '?')}] {_truncate(str(r.get('mission') or ''), 120)}"
                f" | extrait: {_truncate(str(r.get('preview') or ''), 280)}"
            )
        if rlines:
            sections.append("## 2. Missions récentes (mémoire opérationnelle)\n" + "\n".join(rlines))

    pending = ctx.get("pending_decisions") if isinstance(ctx.get("pending_decisions"), list) else []
    if pending:
        plines = []
        for p in pending[:12]:
            if not isinstance(p, dict):
                continue
            plines.append(f"- [{p.get('kind')}] job={p.get('job_id') or '—'} — {p.get('title')}")
            if p.get("questions"):
                plines.append(f"  questions: {p.get('questions')}")
            if p.get("learnings"):
                plines.append(f"  apprentissages: {p.get('learnings')}")
        if plines:
            sections.append("## 3. Décisions en attente (dirigeant)\n" + "\n".join(plines))

    digest = ctx.get("missions_digest") if isinstance(ctx.get("missions_digest"), list) else []
    if digest:
        dlines = [
            f"- [#{j.get('id')}] [{j.get('agent')}] {_truncate(str(j.get('mission') or ''), 100)}"
            f" → {_truncate(str(j.get('result') or ''), 200)}"
            for j in digest[:6]
            if isinstance(j, dict)
        ]
        if dlines:
            sections.append("## 4. Bilans missions terminées\n" + "\n".join(dlines))

    threads = ctx.get("thread_excerpts") if isinstance(ctx.get("thread_excerpts"), list) else []
    if threads:
        tlines = []
        for t in threads[:4]:
            if not isinstance(t, dict):
                continue
            tlines.append(f"### Mission #{t.get('job_id')} ({t.get('status')})\n{t.get('mission')}")
            for msg in (t.get("thread_tail") or [])[:5]:
                if not isinstance(msg, dict):
                    continue
                role = msg.get("role") or "?"
                agent = msg.get("agent") or ""
                tlines.append(f"  - [{role}/{agent}] {_truncate(str(msg.get('content') or ''), 220)}")
        if tlines:
            sections.append("## 5. Fils de mission récents\n" + "\n".join(tlines))

    learn = ctx.get("learning_pending") if isinstance(ctx.get("learning_pending"), list) else []
    if learn:
        llines = [
            f"- [{l.get('job_id') or l.get('suggestion_id')}] {l.get('title')}"
            for l in learn[:4]
            if isinstance(l, dict)
        ]
        if llines:
            sections.append("## 6. Apprentissages en attente\n" + "\n".join(llines))

    body = "\n\n".join(sections)
    if len(body) > max_chars:
        body = body[: max_chars - 20] + "\n…(tronqué)"
    return body or "(contexte minimal — enrichir la mémoire entreprise et lancer des missions)"
