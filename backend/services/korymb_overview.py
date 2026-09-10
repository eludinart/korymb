"""Vue lecture seule de l'état Korymb (chat / agents) — aucun secret."""
from __future__ import annotations

import re
from typing import Any

_SECRETISH = re.compile(
    r"(?i)(sk-|sk_|bearer\s+[a-z0-9._\-]+|api[_-]?key\s*[:=]\s*\S+|token\s*[:=]\s*\S+)"
)


def _scrub(text: str, limit: int = 180) -> str:
    raw = (text or "").replace("\n", " ").strip()
    raw = _SECRETISH.sub("[redacted]", raw)
    if len(raw) > limit:
        return raw[: limit - 1] + "…"
    return raw


def _status_bucket(status: str) -> str:
    s = (status or "").strip().lower()
    if s.startswith("error"):
        return "error"
    if s in {"running", "queued", "accepted"}:
        return "running"
    if s == "awaiting_validation":
        return "hitl"
    if s in {"completed", "validated", "closed"}:
        return "done"
    return "other"


def _probe_line(name: str, row: dict[str, Any]) -> str:
    ok = bool(row.get("ok"))
    configured = row.get("configured")
    provider = str(row.get("provider") or "").strip()
    mark = "OK" if ok else "KO"
    extra: list[str] = []
    if provider:
        extra.append(provider)
    if configured is False:
        extra.append("non configuré")
    elif configured is True and not ok:
        extra.append("configuré")
    suffix = f" ({', '.join(extra)})" if extra else ""
    return f"- {name}: {mark}{suffix}"


def build_korymb_overview() -> str:
    """Synthèse courte pour le CIO : jobs, HITL, CRM, sondes. Sans secrets."""
    lines: list[str] = ["## État Korymb (lecture seule)"]

    try:
        from database import list_jobs_summary

        jobs = list_jobs_summary(limit=24)
        buckets = {"running": 0, "hitl": 0, "error": 0, "done": 0, "other": 0}
        for row in jobs:
            buckets[_status_bucket(str(row.get("status") or ""))] += 1
        lines.append(
            "### Jobs récents\n"
            f"- En cours : {buckets['running']} · HITL : {buckets['hitl']} · "
            f"Erreurs : {buckets['error']} · Terminés : {buckets['done']}"
        )
    except Exception as exc:
        lines.append(f"### Jobs récents\n- Indisponible ({_scrub(str(exc), 80)})")

    try:
        from services.action_queue import list_actions

        tickets = list_actions(status="pending", limit=20)
        n = len(tickets)
        kinds: dict[str, int] = {}
        for t in tickets:
            k = str(t.get("kind") or "autre")
            kinds[k] = kinds.get(k, 0) + 1
        detail = ", ".join(f"{k}={v}" for k, v in sorted(kinds.items())) if kinds else "aucun"
        lines.append(f"### Décisions (tickets d'action)\n- En attente : {n} ({detail})")
    except Exception as exc:
        lines.append(f"### Décisions (tickets d'action)\n- Indisponible ({_scrub(str(exc), 80)})")

    try:
        from database import list_learning_suggestions, list_config_suggestions

        mem_n = len(list_learning_suggestions(status="pending", limit=20))
        cfg_n = len(list_config_suggestions(status="pending", limit=20))
        lines.append(
            "### Files à valider\n"
            f"- Mémoire à confirmer : {mem_n} · Recos / propositions plateforme : {cfg_n}"
        )
    except Exception:
        lines.append("### Files à valider\n- Indisponible")

    try:
        from services.business_db import get_business_overview

        stats = get_business_overview()
        lines.append(
            "### Gestion\n"
            f"- Contacts actifs : {int(stats.get('contacts_active') or 0)} · "
            f"Projets : {int(stats.get('projects_active') or 0)} · "
            f"Devis en cours : {int(stats.get('quotes_pending') or 0)} · "
            f"Créneaux cette semaine : {int(stats.get('events_this_week') or 0)} · "
            f"Mails à traiter : {int(stats.get('email_needs_reply') or 0)}"
        )
    except Exception as exc:
        lines.append(f"### Gestion\n- Indisponible ({_scrub(str(exc), 80)})")

    try:
        from database import get_enterprise_memory

        mem = get_enterprise_memory()
        contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
        keys = [str(k) for k in contexts.keys() if str(k) not in {"auto_summary_updated_at", "memory_compacted_at"}]
        global_len = len(str(contexts.get("global") or "").strip())
        lines.append(
            "### Mémoire entreprise\n"
            f"- Volets : {', '.join(keys[:12]) or '(vide)'} · volet global : {global_len} car."
        )
    except Exception:
        lines.append("### Mémoire entreprise\n- Indisponible")

    try:
        from tools_health import probe_tools_health

        probe = probe_tools_health(force=False)
        interesting = (
            "web_search",
            "read_webpage",
            "gmail",
            "send_email",
            "google_drive",
            "instagram",
            "facebook",
        )
        probe_lines = ["### Sondes outils"]
        for name in interesting:
            row = probe.get(name)
            if isinstance(row, dict):
                probe_lines.append(_probe_line(name, row))
        cached = "oui" if probe.get("cached") else "non"
        probe_lines.append(f"- cache : {cached}")
        lines.append("\n".join(probe_lines))
    except Exception as exc:
        lines.append(f"### Sondes outils\n- Indisponible ({_scrub(str(exc), 80)})")

    lines.append(
        "\nAucun secret n'est exposé. Pour un changement de code ou d'infra, "
        "utilise `propose_platform_change` (spec à valider), pas git."
    )
    return "\n\n".join(lines)
