"""Mémoire des conversations : fiches importées dans le journal vectoriel.

Chaque fiche (Layl ↔ Eric, appels, chat…) devient une ou plusieurs lignes de
`mission_traces` (kind='conversation', agent='classique'), rattachées au
job virtuel `memory:conversations`. Le span_id est dérivé de external_id :
réimporter la même fiche ne crée pas de doublon (identique → ignorée,
modifiée → remplacée). Les vecteurs sont calculés par l'encodeur courant.
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

MEMORY_JOB_ID = "memory:conversations"
MEMORY_KIND = "conversation"
MEMORY_AGENT = "classique"
CHUNK_CHARS = 700
MAX_CHUNKS = 20

_SECRET_PATTERNS = [
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"xox[abprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-~+/=]{12,}"),
    re.compile(r"(?i)\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|APIKEY)[A-Z0-9_]*)\s*[=:]\s*\S{6,}"),
]


def redact(text: str) -> str:
    out = str(text or "")
    for pat in _SECRET_PATTERNS:
        if pat.groups:
            out = pat.sub(lambda m: f"{m.group(1)}=[secret masqué]", out)
        else:
            out = pat.sub("[secret masqué]", out)
    return out


def span_prefix(external_id: str) -> str:
    return "cv-" + hashlib.sha256(str(external_id).encode("utf-8")).hexdigest()[:20]


def fiche_text(fiche: dict[str, Any]) -> str:
    parts = [f"[{fiche.get('date') or ''}] {fiche.get('title') or ''}".strip()]
    if fiche.get("project"):
        parts.append(f"Projet : {fiche['project']}")
    if fiche.get("summary"):
        parts.append(str(fiche["summary"]))
    if fiche.get("decisions"):
        parts.append("Décisions : " + " ; ".join(str(d) for d in fiche["decisions"]))
    if fiche.get("actions"):
        parts.append("Actions : " + " ; ".join(str(a) for a in fiche["actions"]))
    if fiche.get("tags"):
        parts.append("Tags : " + ", ".join(str(t) for t in fiche["tags"]))
    if fiche.get("source"):
        parts.append(f"Source : {fiche['source']}")
    return redact("\n".join(p for p in parts if p))


def chunk_text(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Découpe sur paragraphes / phrases, chaque morceau ≤ size caractères."""
    pieces = re.split(r"(?<=[.!?\n])\s+", text.strip())
    chunks: list[str] = []
    cur = ""
    for piece in pieces:
        while len(piece) > size:
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(piece[:size])
            piece = piece[size:]
        if len(cur) + len(piece) + 1 > size and cur:
            chunks.append(cur)
            cur = piece
        else:
            cur = f"{cur} {piece}".strip() if cur else piece
    if cur:
        chunks.append(cur)
    return chunks[:MAX_CHUNKS]


def import_fiches(fiches: list[dict[str, Any]]) -> dict[str, Any]:
    from database import _ws, get_conn, insert_mission_trace
    from services.trace_vectors import embed_texts, write_trace_vector

    results: list[dict[str, Any]] = []
    stats = {"created": 0, "updated": 0, "skipped": 0, "embedded": 0, "chunks": 0}
    for fiche in fiches:
        ext = str(fiche["external_id"]).strip()
        prefix = span_prefix(ext)
        text = fiche_text(fiche)
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
        with get_conn() as conn:
            existing = [dict(r) for r in conn.execute(
                "SELECT span_id, ref_key FROM mission_traces WHERE workspace_id=? AND job_id=? AND span_id LIKE ?",
                (_ws(), MEMORY_JOB_ID, prefix + "-%"),
            ).fetchall()]
        if existing and all(r.get("ref_key") == digest for r in existing):
            stats["skipped"] += 1
            results.append({"external_id": ext, "status": "skipped", "chunks": len(existing)})
            continue
        if existing:
            with get_conn() as conn:
                conn.execute(
                    "DELETE FROM mission_traces WHERE workspace_id=? AND job_id=? AND span_id LIKE ?",
                    (_ws(), MEMORY_JOB_ID, prefix + "-%"),
                )
                conn.commit()
        chunks = chunk_text(text)
        span_ids = []
        for i, chunk in enumerate(chunks):
            sid = f"{prefix}-{i:02d}"
            insert_mission_trace(
                job_id=MEMORY_JOB_ID, span_id=sid, graph_node="memory:import",
                agent=MEMORY_AGENT, kind=MEMORY_KIND, excerpt=chunk, ref_key=digest,
            )
            span_ids.append(sid)
        embedded = 0
        try:
            vectors = embed_texts(chunks) or []
            for sid, vec in zip(span_ids, vectors):
                if vec and write_trace_vector(sid, vec):
                    embedded += 1
        except Exception:
            logger.exception("vecteurs de la fiche %s ignorés", ext)
        status = "updated" if existing else "created"
        stats[status] += 1
        stats["chunks"] += len(chunks)
        stats["embedded"] += embedded
        results.append({"external_id": ext, "status": status, "chunks": len(chunks), "embedded": embedded})
    return {"ok": True, **stats, "results": results}
