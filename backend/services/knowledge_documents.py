"""Science de l'entreprise — documents markdown isolés par workspace."""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
from datetime import datetime
from typing import Any

from database import LONG_TEXT_CHARS, _is_mariadb, clip_long_text, get_conn
from workspace_db import ws_id

logger = logging.getLogger("korymb.knowledge_documents")

DOC_STATUSES = ("active", "archived")
MEMORY_JOB_ID = "memory:knowledge"
MEMORY_KIND = "knowledge"
MEMORY_AGENT = "classique"


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id() -> str:
    return f"kd-{secrets.token_hex(6)}"


def _ws() -> str:
    return ws_id()


def _pk() -> str:
    return "VARCHAR(191)" if _is_mariadb() else "TEXT"


def _column_names(conn, table: str) -> set[str]:
    if _is_mariadb():
        cur = conn.execute(f"SHOW COLUMNS FROM {table}")
        return {str(row["Field"]) for row in cur.fetchall()}
    cur = conn.execute(f"PRAGMA table_info({table})")
    return {str(row[1]) for row in cur.fetchall()}


def ensure_knowledge_document_tables(conn) -> None:
    pk = _pk()
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS knowledge_documents (
            id                 {pk} PRIMARY KEY,
            workspace_id       {pk} NOT NULL,
            title              TEXT NOT NULL,
            summary            TEXT NOT NULL DEFAULT '',
            content_md         TEXT NOT NULL DEFAULT '',
            resource_file_id   TEXT NOT NULL DEFAULT '',
            project_id         {pk},
            tags_json          TEXT NOT NULL DEFAULT '[]',
            category           TEXT NOT NULL DEFAULT '',
            author             TEXT NOT NULL DEFAULT '',
            status             TEXT NOT NULL DEFAULT 'active',
            created_at         TEXT NOT NULL,
            updated_at         TEXT NOT NULL
        )
    """)
    columns = _column_names(conn, "knowledge_documents")
    if "status" not in columns:
        conn.execute(
            "ALTER TABLE knowledge_documents ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"
        )


def _tags_list(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(t).strip()[:64] for t in raw if str(t).strip()][:24]
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return _tags_list(parsed)
        except json.JSONDecodeError:
            return [p.strip()[:64] for p in raw.split(",") if p.strip()][:24]
    return []


def _public(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    out = dict(row)
    out["tags"] = _tags_list(out.pop("tags_json", "[]"))
    out["project_id"] = out.get("project_id") or None
    out["resource_file_id"] = str(out.get("resource_file_id") or "")
    out["archived"] = str(out.get("status") or "") == "archived"
    return out


def _row(doc_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT * FROM knowledge_documents WHERE id=? AND workspace_id=?",
            (doc_id, _ws()),
        )
        row = cur.fetchone()
    return _public(dict(row) if row else None)


def list_knowledge_documents(
    *,
    project_id: str | None = None,
    tag: str | None = None,
    category: str | None = None,
    q: str | None = None,
    include_archived: bool = False,
    limit: int = 200,
) -> list[dict[str, Any]]:
    clauses = ["workspace_id=?"]
    vals: list[Any] = [_ws()]
    if not include_archived:
        clauses.append("status='active'")
    if project_id:
        clauses.append("project_id=?")
        vals.append(project_id.strip())
    if category:
        clauses.append("category=?")
        vals.append(category.strip()[:120])
    sql = (
        "SELECT * FROM knowledge_documents WHERE "
        + " AND ".join(clauses)
        + " ORDER BY updated_at DESC LIMIT ?"
    )
    vals.append(max(1, min(int(limit), 500)))
    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute(sql, vals).fetchall()]
    out: list[dict[str, Any]] = []
    needle = (q or "").strip().lower()
    tag_l = (tag or "").strip().lower()
    for row in rows:
        pub = _public(row)
        if not pub:
            continue
        if tag_l and tag_l not in [t.lower() for t in pub.get("tags") or []]:
            continue
        if needle:
            blob = " ".join(
                [
                    str(pub.get("title") or ""),
                    str(pub.get("summary") or ""),
                    str(pub.get("content_md") or ""),
                    " ".join(pub.get("tags") or []),
                    str(pub.get("category") or ""),
                ]
            ).lower()
            if needle not in blob:
                continue
        out.append(pub)
    return out


def get_knowledge_document(doc_id: str) -> dict[str, Any] | None:
    return _row(doc_id)


def create_knowledge_document(
    *,
    title: str,
    summary: str = "",
    content_md: str = "",
    resource_file_id: str = "",
    project_id: str | None = None,
    tags: list[str] | None = None,
    category: str = "",
    author: str = "",
) -> dict[str, Any]:
    from services.business_db import get_project

    label = (title or "").strip()
    if not label:
        raise ValueError("Le titre est obligatoire.")
    pid = (project_id or "").strip() or None
    if pid and not get_project(pid):
        raise ValueError("Projet introuvable.")
    doc_id = _new_id()
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO knowledge_documents "
            "(id, workspace_id, title, summary, content_md, resource_file_id, project_id, "
            "tags_json, category, author, status, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                doc_id,
                _ws(),
                label[:400],
                clip_long_text(summary or "", limit=4000),
                clip_long_text(content_md or "", limit=LONG_TEXT_CHARS),
                (resource_file_id or "").strip()[:191],
                pid,
                json.dumps(_tags_list(tags or []), ensure_ascii=False),
                (category or "").strip()[:120],
                (author or "").strip()[:120],
                "active",
                now,
                now,
            ),
        )
        conn.commit()
    row = _row(doc_id) or {}
    try:
        index_knowledge_document(row)
    except Exception:
        logger.exception("index knowledge %s", doc_id)
    return row


def update_knowledge_document(doc_id: str, **fields: Any) -> dict[str, Any] | None:
    from services.business_db import get_project

    current = _row(doc_id)
    if not current:
        return None
    if current.get("status") == "archived" and "status" not in fields:
        raise ValueError("Document archivé — rouvrir avant modification.")
    allowed = {
        "title",
        "summary",
        "content_md",
        "resource_file_id",
        "project_id",
        "tags",
        "category",
        "author",
        "status",
    }
    sets = ["updated_at=?"]
    vals: list[Any] = [_now()]
    for key, val in fields.items():
        if key not in allowed:
            continue
        if key == "title":
            label = str(val or "").strip()
            if not label:
                raise ValueError("Le titre est obligatoire.")
            sets.append("title=?")
            vals.append(label[:400])
        elif key == "summary":
            sets.append("summary=?")
            vals.append(clip_long_text(str(val or ""), limit=4000))
        elif key == "content_md":
            sets.append("content_md=?")
            vals.append(clip_long_text(str(val or ""), limit=LONG_TEXT_CHARS))
        elif key == "resource_file_id":
            sets.append("resource_file_id=?")
            vals.append(str(val or "").strip()[:191])
        elif key == "project_id":
            pid = str(val or "").strip() or None
            if pid and not get_project(pid):
                raise ValueError("Projet introuvable.")
            sets.append("project_id=?")
            vals.append(pid)
        elif key == "tags":
            sets.append("tags_json=?")
            vals.append(json.dumps(_tags_list(val), ensure_ascii=False))
        elif key == "category":
            sets.append("category=?")
            vals.append(str(val or "").strip()[:120])
        elif key == "author":
            sets.append("author=?")
            vals.append(str(val or "").strip()[:120])
        elif key == "status":
            if val not in DOC_STATUSES:
                raise ValueError("Statut invalide.")
            sets.append("status=?")
            vals.append(val)
    if len(sets) == 1:
        return current
    vals.extend([doc_id, _ws()])
    with get_conn() as conn:
        conn.execute(
            f"UPDATE knowledge_documents SET {', '.join(sets)} WHERE id=? AND workspace_id=?",
            vals,
        )
        conn.commit()
    row = _row(doc_id)
    if row:
        try:
            if row.get("status") == "archived":
                deindex_knowledge_document(doc_id)
            else:
                index_knowledge_document(row)
        except Exception:
            logger.exception("reindex knowledge %s", doc_id)
    return row


def archive_knowledge_document(doc_id: str) -> dict[str, Any] | None:
    return update_knowledge_document(doc_id, status="archived")


def index_knowledge_document(doc: dict[str, Any]) -> dict[str, Any]:
    """Indexe le document dans le journal vectoriel (external_id = id)."""
    from services.conversation_memory import chunk_text, redact, span_prefix
    from database import insert_mission_trace
    from services.trace_vectors import embed_texts, write_trace_vector

    ext = str(doc.get("id") or "").strip()
    if not ext:
        return {"ok": False, "reason": "missing id"}
    parts = [
        f"# {doc.get('title') or ''}".strip(),
        f"Catégorie : {doc.get('category')}" if doc.get("category") else "",
        f"Résumé : {doc.get('summary')}" if doc.get("summary") else "",
        str(doc.get("content_md") or ""),
    ]
    if doc.get("tags"):
        parts.append("Tags : " + ", ".join(doc["tags"]))
    if doc.get("project_id"):
        parts.append(f"Projet : {doc['project_id']}")
    text = redact("\n\n".join(p for p in parts if p))
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
    prefix = span_prefix(f"knowledge:{ext}").replace("cv-", "kd-", 1)
    with get_conn() as conn:
        existing = [
            dict(r)
            for r in conn.execute(
                "SELECT span_id, ref_key FROM mission_traces WHERE workspace_id=? AND job_id=? AND span_id LIKE ?",
                (_ws(), MEMORY_JOB_ID, prefix + "-%"),
            ).fetchall()
        ]
    if existing and all(r.get("ref_key") == digest for r in existing):
        return {"ok": True, "status": "skipped", "chunks": len(existing)}
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
            job_id=MEMORY_JOB_ID,
            span_id=sid,
            graph_node="knowledge:index",
            agent=MEMORY_AGENT,
            kind=MEMORY_KIND,
            excerpt=chunk,
            ref_key=digest,
        )
        span_ids.append(sid)
    embedded = 0
    try:
        vectors = embed_texts(chunks) or []
        for sid, vec in zip(span_ids, vectors):
            if vec and write_trace_vector(sid, vec):
                embedded += 1
    except Exception:
        logger.exception("vecteurs knowledge %s", ext)
    return {
        "ok": True,
        "status": "updated" if existing else "created",
        "chunks": len(chunks),
        "embedded": embedded,
        "external_id": ext,
    }


def deindex_knowledge_document(doc_id: str) -> None:
    from services.conversation_memory import span_prefix

    prefix = span_prefix(f"knowledge:{doc_id}").replace("cv-", "kd-", 1)
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM mission_traces WHERE workspace_id=? AND job_id=? AND span_id LIKE ?",
            (_ws(), MEMORY_JOB_ID, prefix + "-%"),
        )
        conn.commit()


def migrate_calendar_document_events(*, dry_run: bool = False) -> dict[str, Any]:
    """Crée un knowledge_document pour chaque événement matière avec fichier, sans supprimer l'événement."""
    created = 0
    skipped = 0
    with get_conn() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM biz_calendar_events WHERE workspace_id=? AND COALESCE(resource_file_id,'') != '' "
                "ORDER BY updated_at DESC LIMIT 500",
                (_ws(),),
            ).fetchall()
        ]
    for row in rows:
        origin = f"cal-doc:{row.get('id')}"
        with get_conn() as conn:
            exists = conn.execute(
                "SELECT id FROM knowledge_documents WHERE workspace_id=? AND author=? LIMIT 1",
                (_ws(), origin),
            ).fetchone()
        if exists:
            skipped += 1
            continue
        title = str(row.get("title") or "Document calendrier").strip()[:400]
        if dry_run:
            created += 1
            continue
        create_knowledge_document(
            title=title,
            summary=str(row.get("notes") or "")[:2000],
            content_md=str(row.get("notes") or ""),
            resource_file_id=str(row.get("resource_file_id") or ""),
            project_id=str(row.get("project_id") or "") or None,
            tags=["calendrier"],
            category="Calendrier",
            author=origin,
        )
        created += 1
    return {"ok": True, "created": created, "skipped": skipped, "dry_run": dry_run}
