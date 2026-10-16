"""Journal d'une mission : départs, outils, validations, citations.

Une écriture ratée ne doit jamais arrêter la mission.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from typing import Any, Callable

logger = logging.getLogger(__name__)

_EXCERPT_MAX = 800


def note_mission(
    job_id: str | None,
    *,
    kind: str,
    agent: str = "",
    excerpt: str = "",
    ref_key: str = "",
    graph_node: str = "",
) -> str:
    """Ajoute une ligne au journal. Retourne l'identifiant, ou vide si rien n'a été écrit."""
    jid = str(job_id or "").strip()[:64]
    if not jid:
        return ""
    span_id = uuid.uuid4().hex[:16]
    try:
        from database import insert_mission_trace

        insert_mission_trace(
            job_id=jid,
            span_id=span_id,
            graph_node=(graph_node or kind)[:64],
            agent=str(agent or "")[:64],
            kind=str(kind or "note")[:32],
            excerpt=str(excerpt or "")[:_EXCERPT_MAX],
            ref_key=str(ref_key or "")[:64],
        )
    except Exception:
        logger.exception("journal mission ignoré pour %s", jid)
        return ""
    return span_id


def tool_fingerprint(name: str, args: Any) -> str:
    try:
        blob = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
    except Exception:
        blob = str(args)
    raw = f"{name}:{blob[:2000]}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def run_tool_once(job_id: str | None, name: str, args: Any, execute: Callable[[], str]) -> str:
    """Relit un outil déjà réussi avec les mêmes arguments, sinon l'exécute et le note."""
    fingerprint = tool_fingerprint(name, args)
    jid = str(job_id or "").strip()[:64]
    if jid:
        previous = _successful_tool_excerpt(jid, fingerprint)
        if previous:
            note_mission(
                jid,
                kind="tool_replay",
                agent=name[:64],
                excerpt=previous,
                ref_key=fingerprint,
                graph_node=f"tool:{name}"[:64],
            )
            return previous
    try:
        out = execute()
    except Exception as exc:
        note_mission(
            jid,
            kind="tool_error",
            agent=name[:64],
            excerpt=str(exc)[:_EXCERPT_MAX],
            ref_key=fingerprint,
            graph_node=f"tool:{name}"[:64],
        )
        raise
    text = str(out or "")
    failed = text.startswith("Erreur outil ") or text.startswith("Erreur recherche")
    note_mission(
        jid,
        kind="tool_error" if failed else "tool",
        agent=name[:64],
        excerpt=text[:_EXCERPT_MAX],
        ref_key=fingerprint,
        graph_node=f"tool:{name}"[:64],
    )
    return text


def span_ids_for(job_id: str, *, limit: int = 12) -> list[str]:
    try:
        from database import search_mission_traces

        rows = search_mission_traces(job_id=job_id, limit=limit)
    except Exception:
        logger.exception("lecture des identifiants de journal pour %s", job_id)
        return []
    return [str(row.get("span_id") or "") for row in rows if row.get("span_id")]


def with_citation(row: dict) -> dict:
    out = dict(row)
    out["citation"] = {
        "span_id": str(out.get("span_id") or ""),
        "kind": str(out.get("kind") or "note"),
        "agent": str(out.get("agent") or ""),
        "excerpt": str(out.get("excerpt") or "")[:500],
    }
    return out


def _successful_tool_excerpt(job_id: str, fingerprint: str) -> str:
    try:
        from database import search_mission_traces

        rows = search_mission_traces(job_id=job_id, kind="tool", ref_key=fingerprint, limit=1)
    except Exception:
        logger.exception("relecture d'outil ignorée pour %s", job_id)
        return ""
    if not rows:
        return ""
    return str(rows[-1].get("excerpt") or "")
