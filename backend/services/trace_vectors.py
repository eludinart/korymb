"""Vecteurs du journal de mission.

La colonne n'existe que sur MariaDB. SQLite partage le CREATE TABLE et
ne reçoit pas de type VECTOR. La dimension est lue dans KORYMB_VECTOR_DIM
(défaut 768). Aucun modèle d'embedding n'est appelé : sans
KORYMB_EMBED_PROVIDER=hash, les extraits restent sans vecteur et l'index
n'est pas créé.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re

logger = logging.getLogger(__name__)

_DEFAULT_DIM = 768


def trace_vector_dimensions() -> int:
    raw = os.getenv("KORYMB_VECTOR_DIM", str(_DEFAULT_DIM))
    try:
        dim = int(str(raw).strip())
    except ValueError:
        dim = _DEFAULT_DIM
    return max(8, min(dim, 4096))


def embed_provider() -> str:
    return os.getenv("KORYMB_EMBED_PROVIDER", "").strip().lower()


def embed_excerpt(text: str) -> list[float] | None:
    """Vecteur de l'extrait, ou None si aucun encodeur n'est activé."""
    if embed_provider() != "hash":
        return None
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        return None
    return _hash_embed(cleaned, trace_vector_dimensions())


def store_trace_embedding(span_id: str, excerpt: str) -> None:
    """Écrit le vecteur d'une ligne déjà insérée. N'échoue jamais vers l'appelant."""
    sid = str(span_id or "").strip()[:64]
    if not sid:
        return
    vector = embed_excerpt(excerpt)
    if not vector:
        return
    try:
        from database import _is_mariadb, get_conn

        if not _is_mariadb():
            return
        literal = json.dumps(vector, separators=(",", ":"))
        with get_conn() as conn:
            conn.execute(
                "UPDATE mission_traces SET embedding = VEC_FromText(?) WHERE span_id=? AND workspace_id=?",
                (literal, sid, _workspace_id()),
            )
            conn.commit()
    except Exception:
        logger.exception("vecteur de trace ignoré pour %s", sid)


def search_trace_memory(query: str, *, limit: int = 4) -> list[dict]:
    """Plus proches extraits déjà vectorisés. Vide si l'encodeur ou la colonne manque."""
    vector = embed_excerpt(query)
    if not vector:
        return []
    lim = max(1, min(int(limit), 8))
    try:
        from database import _is_mariadb, _ws, get_conn

        if not _is_mariadb():
            return []
        literal = json.dumps(vector, separators=(",", ":"))
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT span_id, kind, agent, excerpt,
                       VEC_DISTANCE_EUCLIDEAN(embedding, VEC_FromText(?)) AS dist
                FROM mission_traces
                WHERE workspace_id=? AND embedding IS NOT NULL
                ORDER BY dist ASC
                LIMIT ?
                """,
                (literal, _ws(), lim),
            ).fetchall()
    except Exception:
        logger.exception("recherche vectorielle du journal ignorée")
        return []
    out: list[dict] = []
    for row in rows or []:
        item = dict(row)
        item.pop("embedding", None)
        excerpt = " ".join(str(item.get("excerpt") or "").split())
        if not excerpt:
            continue
        item["excerpt"] = excerpt[:500]
        out.append(item)
    return out


def trace_memory_block(query: str) -> str:
    """Bloc court pour le prompt, à partir des traces vectorisées."""
    rows = search_trace_memory(query, limit=4)
    lines: list[str] = []
    for row in rows:
        kind = str(row.get("kind") or "note")
        excerpt = str(row.get("excerpt") or "")[:280]
        if excerpt:
            lines.append(f"- {kind} : {excerpt}")
    if not lines:
        return ""
    return "\n### Souvenirs du journal\n" + "\n".join(lines) + "\n"


def _hash_embed(text: str, dim: int) -> list[float]:
    """Empreinte locale, le temps qu'un modèle d'embedding soit choisi."""
    vec = [0.0] * dim
    tokens = re.findall(r"[a-z0-9àâäéèêëïîôùûüç]+", text.lower()) or ["vide"]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        slot = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vec[slot] += sign
    norm = math.sqrt(sum(value * value for value in vec)) or 1.0
    return [round(value / norm, 6) for value in vec]


def _workspace_id() -> str:
    from database import _ws

    return _ws()
