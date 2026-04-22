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
    updated_at = mem.get("updated_at")

    if cached_summary and not _summary_is_stale(updated_at):
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

    # Persister avec timestamp de maintenant
    try:
        merge_enterprise_contexts({"auto_summary": summary_text})
    except Exception:
        logger.exception("summarize_mission_history: failed to persist summary")

    return summary_text


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
        f"- #{row.get('id')} [{row.get('status')}] {row.get('agent')}: "
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
                f"- #{row.get('id')} [{row.get('status')}] {row.get('agent')}: "
                f"{str(row.get('mission') or '')[:180]}"
                for row in snap.recent_jobs_digest
            ]
            blocks.append("Historique missions recentes:\n" + "\n".join(rows))
    elif snap.recent_jobs_digest:
        rows = [
            f"- #{row.get('id')} [{row.get('status')}] {row.get('agent')}: "
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
