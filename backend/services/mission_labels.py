"""Libellés missions : titre lisible plutôt que numéro technique (#job_id)."""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

_MISSION_ID_REF = re.compile(r"Mission\s*#([0-9a-fA-F]{4,16})\b", re.IGNORECASE)
_HASH_JOB_REF = re.compile(r"#([0-9a-fA-F]{6,16})\b")


def clip_mission_title(text: str | None, max_len: int = 120) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if not t:
        return ""
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def mission_block_heading(mission: str | None, jid: str) -> str:
    title = clip_mission_title(mission, 100)
    return f"### {title}" if title else f"### Mission sans titre"


def mission_block_meta(*, jid: str, agent: str, status: str, created: str, source: str) -> str:
    return f"(réf. {jid} · agent pilote: {agent} · {status} · {created} · source {source})"


def _title_for_job_id(jid: str, cache: dict[str, str]) -> str:
    if jid in cache:
        return cache[jid]
    title = ""
    try:
        from database import get_job

        job = get_job(jid)
        if job:
            title = clip_mission_title(str(job.get("mission") or ""), 100)
    except Exception:
        logger.exception("resolve mission title for %s", jid)
    cache[jid] = title
    return title


def resolve_mission_id_refs_in_text(text: str | None) -> str:
    """Remplace Mission #id / #id par l'intitulé de la mission quand il est connu."""
    if not text or not str(text).strip():
        return (text or "").strip()
    out = str(text)
    cache: dict[str, str] = {}

    def repl_prefixed(m: re.Match[str]) -> str:
        title = _title_for_job_id(m.group(1), cache)
        return f"« {title} »" if title else m.group(0)

    def repl_hash(m: re.Match[str]) -> str:
        title = _title_for_job_id(m.group(1), cache)
        return f"« {title} »" if title else m.group(0)

    out = _MISSION_ID_REF.sub(repl_prefixed, out)
    out = _HASH_JOB_REF.sub(repl_hash, out)
    return out
