from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from database import (
    get_enterprise_memory,
    list_jobs_prompt_digest,
    merge_enterprise_contexts,
)
from services.mission_labels import clip_mission_title

logger = logging.getLogger(__name__)

# TTL du résumé automatique dans enterprise_memory["contexts"]["auto_summary"]
_SUMMARY_TTL_HOURS = 6


@dataclass
class ActiveMemorySnapshot:
    enterprise_memory: dict[str, Any]
    proposals: list[dict[str, str]]
    recent_jobs_digest: list[dict[str, Any]]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


# ── Artifact scanning ─────────────────────────────────────────────────────────

def _parse_proposal_version(stem: str) -> tuple[int, int, int]:
    """
    Extrait (major, minor, patch) depuis le stem d'un fichier .proposal.tsx.
    Exemples : 'dashboard.v2', 'foo.v1.3', 'bar' → (0,0,0)
    """
    m = re.search(r"[._-]v(\d+)(?:[._-](\d+))?(?:[._-](\d+))?", stem, re.IGNORECASE)
    if not m:
        return (0, 0, 0)
    major = int(m.group(1) or 0)
    minor = int(m.group(2) or 0)
    patch = int(m.group(3) or 0)
    return (major, minor, patch)


def _collect_proposals(limit: int = 8) -> list[dict[str, str]]:
    root = _repo_root()
    files = sorted(root.rglob("*.proposal.tsx"), key=lambda p: p.stat().st_mtime, reverse=True)
    capped = files[: max(1, min(limit, 20))]

    # Grouper par nom de base (sans version) pour détecter les itérations
    base_groups: dict[str, list[Path]] = {}
    for path in capped:
        stem = path.stem.replace(".proposal", "")
        base = re.sub(r"[._-]v\d+.*$", "", stem, flags=re.IGNORECASE) or stem
        base_groups.setdefault(base, []).append(path)

    out: list[dict[str, str]] = []
    for path in capped:
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
            stat = path.stat()
        except OSError:
            continue
        stem = path.stem.replace(".proposal", "")
        base = re.sub(r"[._-]v\d+.*$", "", stem, flags=re.IGNORECASE) or stem
        version = _parse_proposal_version(stem)
        siblings = base_groups.get(base, [])
        iterations = len(siblings)
        size_kb = round(stat.st_size / 1024, 1)
        mtime = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M")
        out.append(
            {
                "path": str(path.relative_to(root)).replace("\\", "/"),
                "content_preview": content[:4000],
                "version": f"v{version[0]}.{version[1]}.{version[2]}",
                "iterations": str(iterations),
                "size_kb": str(size_kb),
                "mtime": mtime,
            }
        )
    return out


# ── Summarizer ────────────────────────────────────────────────────────────────

def _summary_is_stale(updated_at: str | None) -> bool:
    """Retourne True si le résumé doit être régénéré (inexistant ou > TTL)."""
    if not updated_at:
        return True
    try:
        ts = datetime.fromisoformat(updated_at)
    except (ValueError, TypeError):
        return True
    return datetime.utcnow() - ts > timedelta(hours=_SUMMARY_TTL_HOURS)


def summarize_mission_history(job_limit: int = 10) -> str:
    """
    Compresse l'historique des missions en un résumé compact (Loi de Simplification).
    Stocké dans enterprise_memory["contexts"]["auto_summary"] avec TTL de 6h.
    Retourne le résumé (depuis le cache si récent, régénéré sinon).
    """
    mem = get_enterprise_memory()
    contexts = mem.get("contexts") or {}
    cached_summary = contexts.get("auto_summary", "")
    summary_updated_at = contexts.get("auto_summary_updated_at", "")

    if cached_summary and not _summary_is_stale(summary_updated_at):
        return cached_summary

    jobs = list_jobs_prompt_digest(limit=job_limit)
    if not jobs:
        return ""

    # Construction du corpus brut
    lines: list[str] = []
    for j in jobs:
        preview = (j.get("result") or "")[:600]
        lines.append(
            f"[{j.get('id')}] {j.get('agent')} — {j.get('mission', '')[:160]}\n"
            f"  → {preview}"
        )
    corpus = "\n\n".join(lines)

    system = (
        "Tu es l'assistant de synthèse mémorielle de KORYMB. "
        "Extrait la 'substantifique moelle' de cet historique de missions : "
        "identifie les décisions clés, les patterns récurrents, les risques actifs, "
        "les livrables validés et les points de tension à surveiller. "
        "Sois dense, précis, opérationnel. Maximum 600 mots en français."
    )
    prompt = f"Historique des {len(jobs)} dernières missions KORYMB :\n\n{corpus}"

    try:
        from config import TEMP_SYST
        from llm_client import llm_turn
        summary_text, _, _ = llm_turn(
            system,
            prompt,
            max_tokens=900,
            or_profile="lite",
            usage_context="memory:summarize_mission_history",
            temperature=TEMP_SYST,
        )
        summary_text = summary_text.strip()
    except Exception:
        logger.exception("summarize_mission_history: LLM call failed, using raw digest")
        summary_text = "\n".join(
            f"- {j.get('agent')}: {j.get('mission', '')[:100]}" for j in jobs
        )

    # Persister avec horodatage dédié (indépendant de updated_at / recent_missions).
    try:
        merge_enterprise_contexts(
            {
                "auto_summary": summary_text,
                "auto_summary_updated_at": datetime.utcnow().isoformat(),
            },
        )
    except Exception:
        logger.exception("summarize_mission_history: failed to persist summary")

    return summary_text


def maybe_refresh_mission_summary() -> None:
    """Régénère auto_summary si absent ou TTL expiré (best-effort)."""
    try:
        mem = get_enterprise_memory()
        contexts = mem.get("contexts") or {}
        if not isinstance(contexts, dict):
            contexts = {}
        cached = contexts.get("auto_summary", "")
        summary_at = contexts.get("auto_summary_updated_at", "")
        if isinstance(cached, str) and cached.strip() and not _summary_is_stale(summary_at):
            return
        summarize_mission_history()
    except Exception:
        logger.exception("maybe_refresh_mission_summary")


# ── Snapshot & prompt ─────────────────────────────────────────────────────────

def read_active_memory(
    *,
    proposal_limit: int = 8,
    digest_limit: int = 8,
    exclude_job_id: str | None = None,
) -> ActiveMemorySnapshot:
    return ActiveMemorySnapshot(
        enterprise_memory=get_enterprise_memory(),
        proposals=_collect_proposals(limit=proposal_limit),
        recent_jobs_digest=list_jobs_prompt_digest(limit=digest_limit, exclude_job_id=exclude_job_id),
    )


def operational_memory_digest_prompt(
    agent_key: str,
    *,
    exclude_job_id: str | None = None,
    digest_limit: int = 8,
) -> str:
    """
    Historique opérationnel court pour les sous-agents : auto_summary ou digest SQL,
    sans dupliquer global/rôle (déjà dans _korymb_memory_prompt_for) ni les proposals repo.
    """
    _ = agent_key
    mem = get_enterprise_memory()
    contexts = mem.get("contexts") or {}
    auto_summary = contexts.get("auto_summary", "") if isinstance(contexts, dict) else ""
    if isinstance(auto_summary, str) and auto_summary.strip():
        block = auto_summary.strip()[:2000]
        return f"\n\n### Historique opérationnel (résumé)\n{block}\n"
    digest = list_jobs_prompt_digest(limit=digest_limit, exclude_job_id=exclude_job_id)
    if not digest:
        return ""
    rows = [
        f"- {clip_mission_title(str(row.get('mission') or ''), 90) or f'Mission {row.get('id')}'} "
        f"[{row.get('status')}] {row.get('agent')}: "
        f"{str(row.get('mission') or '')[:180]}"
        for row in digest
    ]
    return "\n\n### Historique opérationnel (missions récentes)\n" + "\n".join(rows) + "\n"


def active_memory_prompt(
    agent_key: str,
    *,
    proposal_limit: int = 6,
    digest_limit: int = 8,
    exclude_job_id: str | None = None,
    use_summary: bool = True,
) -> str:
    if use_summary:
        maybe_refresh_mission_summary()

    snap = read_active_memory(
        proposal_limit=proposal_limit,
        digest_limit=digest_limit,
        exclude_job_id=exclude_job_id,
    )
    contexts = snap.enterprise_memory.get("contexts", {})
    agent_context = contexts.get(agent_key, "") if isinstance(contexts, dict) else ""
    global_context = contexts.get("global", "") if isinstance(contexts, dict) else ""
    blocks: list[str] = []

    if isinstance(global_context, str) and global_context.strip():
        blocks.append(f"Contexte global entreprise:\n{global_context[:3500]}")
    if isinstance(agent_context, str) and agent_context.strip():
        blocks.append(f"Contexte specifique role {agent_key}:\n{agent_context[:3500]}")

    # Résumé auto ou liste brute selon disponibilité
    if use_summary:
        auto_summary = contexts.get("auto_summary", "") if isinstance(contexts, dict) else ""
        if isinstance(auto_summary, str) and auto_summary.strip():
            blocks.append(f"Résumé mémoriel des missions passées (auto-généré) :\n{auto_summary[:2000]}")
        elif snap.recent_jobs_digest:
            rows = [
                f"- {clip_mission_title(str(row.get('mission') or ''), 90) or f'Mission {row.get('id')}'} "
                f"[{row.get('status')}] {row.get('agent')}: "
                f"{str(row.get('mission') or '')[:180]}"
                for row in snap.recent_jobs_digest
            ]
            blocks.append("Historique missions recentes:\n" + "\n".join(rows))
    elif snap.recent_jobs_digest:
        rows = [
            f"- {clip_mission_title(str(row.get('mission') or ''), 90) or f'Mission {row.get('id')}'} "
            f"[{row.get('status')}] {row.get('agent')}: "
            f"{str(row.get('mission') or '')[:180]}"
            for row in snap.recent_jobs_digest
        ]
        blocks.append("Historique missions recentes:\n" + "\n".join(rows))

    if snap.proposals:
        props: list[str] = []
        for p in snap.proposals:
            version_info = ""
            if p.get("version") and p["version"] != "v0.0.0":
                version_info = f" [{p['version']}]"
            if p.get("iterations") and int(p["iterations"]) > 1:
                version_info += f" ({p['iterations']} itérations)"
            meta = f"  [{p.get('size_kb', '?')}KB — {p.get('mtime', '?')}]"
            props.append(
                f"Fichier: {p['path']}{version_info}\n{meta}\n{p['content_preview'][:1000]}"
            )
        blocks.append("Proposals internes reutilisables:\n\n".join(props))

    if not blocks:
        return ""
    return "\n\n### Active Memory Skill\n" + "\n\n".join(blocks) + "\n"


def compress_chat_session(
    session_id: str,
    *,
    user_message: str,
    assistant_message: str,
    prior_summary: str = "",
    turn_count: int = 0,
) -> str:
    """
    Synthétise une session chat en état compressé (Sivana, Ti Spoun, Élude In Art).
    Persiste dans chat_sessions via database.upsert_chat_session_summary.
    """
    from database import get_chat_session_summary, upsert_chat_session_summary

    sid = (session_id or "").strip()[:64]
    if not sid:
        return ""
    prev = (prior_summary or get_chat_session_summary(sid) or "").strip()
    user = (user_message or "").strip()[:2000]
    assistant = (assistant_message or "").strip()[:4000]
    if not user and not assistant:
        return prev

    corpus = ""
    if prev:
        corpus += f"Résumé session précédent :\n{prev[:2500]}\n\n"
    corpus += f"Dernier échange :\nUtilisateur : {user}\nCIO : {assistant[:3000]}"

    system = (
        "Tu es l'assistant de synthèse conversationnelle de KORYMB. "
        "Compresse cet historique en état relationnel et opérationnel : décisions, projets "
        "(Sivana, Ti Spoun, Élude In Art), tensions, suites ouvertes. "
        "Maximum 400 mots, français, dense."
    )
    try:
        from config import TEMP_SYST
        from llm_client import llm_turn

        summary_text, _, _ = llm_turn(
            system,
            corpus,
            max_tokens=700,
            or_profile="lite",
            usage_context="memory:compress_chat_session",
            temperature=TEMP_SYST,
        )
        summary_text = (summary_text or "").strip()
    except Exception:
        logger.exception("compress_chat_session: LLM failed")
        summary_text = prev or f"- Utilisateur : {user[:120]}\n- CIO : {assistant[:200]}"

    try:
        upsert_chat_session_summary(sid, summary_text, turn_count + 1)
    except Exception:
        logger.exception("compress_chat_session: persist failed")
    return summary_text

