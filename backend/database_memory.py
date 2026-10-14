"""
database_memory.py — Mémoire entreprise (extrait progressif hors de database.py).

`database` réexporte ces symboles pour compatibilité des imports existants.
"""
from __future__ import annotations

import copy
import json
import time
from datetime import datetime
from typing import Any

_ENTERPRISE_MEM_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_ENTERPRISE_MEM_TTL_SEC = 2.0


def invalidate_enterprise_memory_cache() -> None:
    _ENTERPRISE_MEM_CACHE.clear()


def init_enterprise_memory_row() -> None:
    """Contexte entreprise par espace Korymb. Sans espace courant : ne rien écrire."""
    import database as db

    now = datetime.utcnow().isoformat()
    wid = db._ws()
    if not wid:
        return
    with db.get_conn() as conn:
        text_pk = "VARCHAR(191)" if db._is_mariadb() else "TEXT"
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS enterprise_memory (
                workspace_id {text_pk} PRIMARY KEY,
                contexts_json TEXT NOT NULL DEFAULT '{{}}',
                recent_missions_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL
            )
            """
        )
        row = conn.execute(
            "SELECT workspace_id FROM enterprise_memory WHERE workspace_id=?",
            (wid,),
        ).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO enterprise_memory (contexts_json, recent_missions_json, updated_at, workspace_id) "
                "VALUES ('{}', '[]', ?, ?)",
                (now, wid),
            )
        conn.commit()


def get_enterprise_memory() -> dict:
    import database as db

    wid = db._ws()
    if not wid:
        return {"contexts": {}, "recent_missions": [], "updated_at": None}
    init_enterprise_memory_row()
    now_m = time.monotonic()
    hit = _ENTERPRISE_MEM_CACHE.get(wid)
    if hit is not None and (now_m - hit[0]) < _ENTERPRISE_MEM_TTL_SEC:
        return copy.deepcopy(hit[1])
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT contexts_json, recent_missions_json, updated_at FROM enterprise_memory WHERE workspace_id=?",
            (wid,),
        ).fetchone()
    allowed = db._memory_context_allowed_keys()
    if not row:
        out = {"contexts": {k: "" for k in allowed}, "recent_missions": [], "updated_at": None}
        _ENTERPRISE_MEM_CACHE[wid] = (now_m, copy.deepcopy(out))
        return copy.deepcopy(out)
    try:
        ctx = json.loads(row["contexts_json"] or "{}")
    except json.JSONDecodeError:
        ctx = {}
    if not isinstance(ctx, dict):
        ctx = {}
    base = {k: "" for k in allowed}
    for k, v in ctx.items():
        if k in allowed and isinstance(v, str):
            base[k] = v
    try:
        recent = json.loads(row["recent_missions_json"] or "[]")
    except json.JSONDecodeError:
        recent = []
    if not isinstance(recent, list):
        recent = []
    out = {
        "contexts": base,
        "recent_missions": recent,
        "updated_at": row["updated_at"],
    }
    _ENTERPRISE_MEM_CACHE[wid] = (now_m, copy.deepcopy(out))
    return copy.deepcopy(out)


def merge_enterprise_contexts(updates: dict[str, str] | None) -> dict:
    """Fusionne les champs de contexte (texte libre par rôle + global)."""
    import database as db

    init_enterprise_memory_row()
    invalidate_enterprise_memory_cache()
    cur = get_enterprise_memory()
    allowed = db._memory_context_allowed_keys()
    base = dict(cur["contexts"])
    for k, v in (updates or {}).items():
        if k in allowed and isinstance(v, str):
            base[k] = v
    now = datetime.utcnow().isoformat()
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE enterprise_memory SET contexts_json=?, updated_at=? WHERE workspace_id=?",
            (json.dumps(base, ensure_ascii=False), now, db._ws()),
        )
        conn.commit()
    invalidate_enterprise_memory_cache()
    return get_enterprise_memory()


def delete_enterprise_context_keys(keys: list[str]) -> dict:
    """Retire des volets mémoire éditables du JSON persisté (snapshot recommandé avant)."""
    import database as db

    init_enterprise_memory_row()
    invalidate_enterprise_memory_cache()
    deletable = db._memory_user_deletable_keys()
    to_drop = [str(k).strip() for k in (keys or []) if str(k).strip() in deletable]
    if not to_drop:
        return get_enterprise_memory()
    cur = get_enterprise_memory()
    base = dict(cur.get("contexts") or {})
    for k in to_drop:
        base.pop(k, None)
    to_save = {k: v for k, v in base.items() if isinstance(v, str) and v.strip()}
    now = datetime.utcnow().isoformat()
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE enterprise_memory SET contexts_json=?, updated_at=? WHERE workspace_id=?",
            (json.dumps(to_save, ensure_ascii=False), now, db._ws()),
        )
        conn.commit()
    invalidate_enterprise_memory_cache()
    return get_enterprise_memory()


def append_recent_mission(job_id: str, mission: str, preview: str) -> None:
    """Ajoute une entrée dans l'historique des missions (mémoire opérationnelle, texte long pour le CIO)."""
    import database as db

    init_enterprise_memory_row()
    invalidate_enterprise_memory_cache()
    cur = get_enterprise_memory()
    lst = list(cur.get("recent_missions") or [])
    lst.append(
        {
            "job_id": job_id,
            "mission": (mission or "")[:2000],
            "preview": (preview or "")[:10000],
            "ts": datetime.utcnow().isoformat(),
        },
    )
    lst = lst[-10:]
    now = datetime.utcnow().isoformat()
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE enterprise_memory SET recent_missions_json=?, updated_at=? WHERE workspace_id=?",
            (json.dumps(lst, ensure_ascii=False), now, db._ws()),
        )
        conn.commit()
    invalidate_enterprise_memory_cache()


__all__ = [
    "invalidate_enterprise_memory_cache",
    "init_enterprise_memory_row",
    "get_enterprise_memory",
    "merge_enterprise_contexts",
    "delete_enterprise_context_keys",
    "append_recent_mission",
]
