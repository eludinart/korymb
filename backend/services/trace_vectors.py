"""Vecteurs du journal de mission.

La colonne n'existe que sur MariaDB. SQLite partage le CREATE TABLE et
ne reçoit pas de type VECTOR. La dimension est lue dans KORYMB_VECTOR_DIM
(défaut 768). L'encodeur est choisi par KORYMB_EMBED_PROVIDER :
  - vide      : aucun vecteur, la recherche reste muette ;
  - hash      : empreinte locale de mots (provisoire, sans compréhension du sens) ;
  - openrouter: modèle d'embeddings via https://openrouter.ai/api/v1/embeddings ;
  - openai    : toute API compatible OpenAI (KORYMB_EMBED_BASE_URL).
Un échec d'API est journalisé et ignoré : le chat et le journal ne cassent jamais.
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


_REMOTE_PROVIDERS = ("openrouter", "openai")
_OPENROUTER_BASE = "https://openrouter.ai/api/v1"
_DEFAULT_MODEL = "openai/text-embedding-3-small"


def embed_excerpt(text: str) -> list[float] | None:
    """Vecteur de l'extrait, ou None si aucun encodeur n'est activé ou si l'API échoue."""
    out = embed_texts([text])
    return out[0] if out else None


def embed_texts(texts: list[str]) -> list[list[float] | None] | None:
    """Vecteurs d'une liste de textes (même ordre). None si aucun encodeur."""
    provider = embed_provider()
    if provider not in ("hash", *_REMOTE_PROVIDERS):
        return None
    cleaned = [" ".join(str(t or "").split()) for t in texts]
    dim = trace_vector_dimensions()
    if provider == "hash":
        return [_hash_embed(c, dim) if c else None for c in cleaned]
    todo = [c for c in cleaned if c]
    if not todo:
        return [None] * len(cleaned)
    vectors = _remote_embed(provider, todo, dim)
    if vectors is None:
        return [None] * len(cleaned)
    it = iter(vectors)
    return [next(it) if c else None for c in cleaned]


def embed_config(provider: str | None = None) -> dict:
    """Paramètres effectifs de l'encodeur distant (sans jamais exposer la clé)."""
    prov = provider or embed_provider()
    if prov == "openrouter":
        base = _getenv("KORYMB_EMBED_BASE_URL") or _OPENROUTER_BASE
        key = _getenv("KORYMB_EMBED_API_KEY") or _getenv("OPENROUTER_API_KEY")
    else:
        base = _getenv("KORYMB_EMBED_BASE_URL") or "https://api.openai.com/v1"
        key = _getenv("KORYMB_EMBED_API_KEY") or _getenv("OPENAI_API_KEY")
    model = _getenv("KORYMB_EMBED_MODEL") or _DEFAULT_MODEL
    return {"provider": prov, "base_url": base.rstrip("/"), "model": model, "api_key": key}


def _getenv(name: str) -> str:
    try:
        from integration_settings import getenv

        return str(getenv(name) or "").strip()
    except Exception:
        return str(os.getenv(name) or "").strip()


def _remote_embed(provider: str, texts: list[str], dim: int) -> list[list[float]] | None:
    cfg = embed_config(provider)
    if not cfg["api_key"]:
        logger.warning("encodeur %s sans clé (KORYMB_EMBED_API_KEY) : vecteur ignoré", provider)
        return None
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    if provider == "openrouter":
        headers["HTTP-Referer"] = _getenv("OPENROUTER_HTTP_REFERER") or "https://korymb.eludein.art"
        headers["X-Title"] = _getenv("OPENROUTER_APP_TITLE") or "Korymb"
    body = {"model": cfg["model"], "input": [t[:8000] for t in texts], "encoding_format": "float"}
    if _getenv("KORYMB_EMBED_SEND_DIMENSIONS").lower() not in ("0", "false", "non", "no"):
        body["dimensions"] = dim
    try:
        import httpx

        timeout = float(os.getenv("KORYMB_EMBED_TIMEOUT", "20") or 20)
        r = httpx.post(f"{cfg['base_url']}/embeddings", json=body, headers=headers, timeout=timeout)
        r.raise_for_status()
        data = r.json().get("data") or []
        rows = sorted(data, key=lambda d: int(d.get("index", 0)))
        vectors = [_fit_dimensions([float(x) for x in row["embedding"]], dim) for row in rows]
    except Exception as exc:
        logger.warning("encodeur %s indisponible, vecteur ignoré : %s", provider, type(exc).__name__)
        return None
    if len(vectors) != len(texts):
        logger.warning("encodeur %s : %d vecteurs pour %d textes", provider, len(vectors), len(texts))
        return None
    return vectors


def _fit_dimensions(vec: list[float], dim: int) -> list[float]:
    """Ramène à la dimension de la colonne (troncature type Matryoshka) et normalise."""
    if len(vec) > dim:
        vec = vec[:dim]
    elif len(vec) < dim:
        vec = vec + [0.0] * (dim - len(vec))
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 7) for v in vec]


def store_trace_embedding(span_id: str, excerpt: str) -> None:
    """Écrit le vecteur d'une ligne déjà insérée. N'échoue jamais vers l'appelant."""
    sid = str(span_id or "").strip()[:64]
    if not sid:
        return
    vector = embed_excerpt(excerpt)
    if not vector:
        return
    write_trace_vector(sid, vector)


def write_trace_vector(span_id: str, vector: list[float]) -> bool:
    sid = str(span_id or "").strip()[:64]
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
        return True
    except Exception:
        logger.exception("vecteur de trace ignoré pour %s", sid)
        return False


def reembed_traces(*, batch: int = 32, limit: int = 5000, kinds: list[str] | None = None) -> dict:
    """Recalcule les vecteurs existants avec l'encodeur courant (après passage hash → modèle)."""
    from database import _is_mariadb, get_conn

    if not _is_mariadb():
        return {"ok": False, "reason": "mariadb_requis", "updated": 0}
    if embed_provider() not in ("hash", *_REMOTE_PROVIDERS):
        return {"ok": False, "reason": "encodeur_inactif", "updated": 0}
    sql = "SELECT span_id, excerpt FROM mission_traces WHERE workspace_id=? AND span_id<>'' AND excerpt<>''"
    params: list = [_workspace_id()]
    if kinds:
        sql += " AND kind IN (" + ",".join("?" for _ in kinds) + ")"
        params += list(kinds)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(max(1, min(int(limit), 100000)))
    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute(sql, tuple(params)).fetchall()]
    updated = failed = 0
    size = max(1, min(int(batch), 128))
    for i in range(0, len(rows), size):
        chunk = rows[i:i + size]
        vectors = embed_texts([str(r.get("excerpt") or "") for r in chunk]) or []
        for row, vec in zip(chunk, vectors):
            if vec and write_trace_vector(str(row["span_id"]), vec):
                updated += 1
            else:
                failed += 1
    return {"ok": True, "scanned": len(rows), "updated": updated, "failed": failed, "provider": embed_provider()}


def search_trace_memory(query: str, *, limit: int = 4, kinds: list[str] | None = None) -> list[dict]:
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
        kind_params = [str(k)[:32] for k in (kinds or []) if str(k).strip()]
        kind_sql = (" AND kind IN (" + ",".join("?" for _ in kind_params) + ")") if kind_params else ""
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT span_id, kind, agent, excerpt,
                       VEC_DISTANCE_EUCLIDEAN(embedding, VEC_FromText(?)) AS dist
                FROM mission_traces
                WHERE workspace_id=? AND embedding IS NOT NULL{kind_sql}
                ORDER BY dist ASC
                LIMIT ?
                """.replace("{kind_sql}", kind_sql),
                (literal, _ws(), *kind_params, lim),
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
