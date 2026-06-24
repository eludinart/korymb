"""
Bibliothèque de livrables — agrégation jobs terminés (Drive + in-app).
"""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from services.drive_workspace import parse_livrable_blocks

_THEME_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Prospection & vente", ("prospect", "resalib", "commercial", "lead", "crm", "client", "vente", "tableau")),
    ("Communication", ("linkedin", "instagram", "facebook", "post", "reseau", "publication", "contenu")),
    ("Courriers & emails", ("courrier", "lettre", "mail", "email", "objet:", "relance")),
    ("Veille & marché", ("veille", "concurrent", "marche", "actualite", "tendance")),
    ("Stratégie & pilotage", ("strategie", "plan", "synthese", "cadrage", "pilotage", "mission")),
    ("Finance & admin", ("facture", "budget", "compta", "administratif", "rh")),
]

_AGENT_THEME: dict[str, str] = {
    "commercial": "Prospection & vente",
    "marketing": "Communication",
    "communication": "Communication",
    "juridique": "Finance & admin",
    "rh": "Finance & admin",
    "veille": "Veille & marché",
    "coordinateur": "Stratégie & pilotage",
}


def _ascii_fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def infer_deliverable_theme(*, mission: str = "", title: str = "", agent: str = "") -> str:
    blob = _ascii_fold(f"{mission} {title}")
    for label, hints in _THEME_RULES:
        if any(h in blob for h in hints):
            return label
    ag = _ascii_fold(agent or "")
    for key, label in _AGENT_THEME.items():
        if key in ag:
            return label
    return "Autres livrables"


def _drive_channel(kind: str | None, name: str | None) -> str:
    k = _ascii_fold(kind or "")
    n = _ascii_fold(name or "")
    if "sheet" in k or n.endswith(".csv"):
        return "drive_sheet"
    if "doc" in k or n.endswith(".md"):
        return "drive_doc"
    return "drive_file"


_DRIVE_LINK_RE = re.compile(
    r"\[([^\]]+)\]\((https?://(?:drive|docs)\.google\.com/[^)]+)\)",
    re.IGNORECASE,
)


def _entries_from_job(row: dict[str, Any]) -> list[dict[str, Any]]:
    job_id = str(row.get("id") or "")
    mission = str(row.get("mission") or "")
    source = str(row.get("source") or "mission")
    agent = str(row.get("agent") or "coordinateur")
    created_at = str(row.get("created_at") or row.get("updated_at") or "")
    parent_job_id = row.get("parent_job_id")
    chat_session_id = row.get("chat_session_id")
    result = str(row.get("result") or "")

    entries: list[dict[str, Any]] = []
    seen_href: set[str] = set()
    seen_title: set[str] = set()

    if source == "chat":
        q = []
        if chat_session_id:
            q.append(f"session={chat_session_id}")
        q.append(f"job={job_id}")
        if parent_job_id:
            q.append(f"parent={parent_job_id}")
        href_base = "/chat?" + "&".join(q)
    else:
        href_base = f"/missions?job={job_id}"

    def push(entry: dict[str, Any]) -> None:
        href = str(entry.get("href") or "").strip()
        title = str(entry.get("title") or "").strip()
        key = href or f"{job_id}:{title}"
        if key in seen_title:
            return
        if href and href in seen_href:
            return
        seen_title.add(key)
        if href:
            seen_href.add(href)
        entry.setdefault("theme", infer_deliverable_theme(mission=mission, title=title, agent=entry.get("agent") or agent))
        entry.setdefault("job_id", job_id)
        entry.setdefault("mission", mission[:500])
        entry.setdefault("source", source)
        entry.setdefault("created_at", created_at)
        entry.setdefault("parent_job_id", parent_job_id)
        entry.setdefault("chat_session_id", chat_session_id)
        entry.setdefault("job_href", href_base)
        entries.append(entry)

    try:
        artifacts = json.loads(str(row.get("drive_artifacts_json") or "[]"))
    except Exception:
        artifacts = []
    if isinstance(artifacts, list):
        for art in artifacts:
            if not isinstance(art, dict):
                continue
            href = str(art.get("webViewLink") or art.get("url") or "").strip()
            if not href:
                continue
            name = str(art.get("name") or "Fichier Drive").strip()
            push({
                "id": f"drive:{art.get('id') or href}",
                "title": name,
                "channel": _drive_channel(str(art.get("kind") or ""), name),
                "href": href,
                "agent": str(art.get("agent") or agent),
            })

    for m in _DRIVE_LINK_RE.finditer(result):
        title, href = m.group(1).strip(), m.group(2).strip()
        ch = "drive_sheet" if "spreadsheets" in href else "drive_doc" if "document" in href else "drive_file"
        push({"id": f"mdlink:{href}", "title": title, "channel": ch, "href": href, "agent": agent})

    for block in parse_livrable_blocks(result):
        title = block.get("title") or "Livrable"
        body = block.get("body") or ""
        if not body.strip():
            continue
        has_drive = any(
            title.lower()[:24] in str(e.get("title") or "").lower()
            or str(e.get("title") or "").lower()[:24] in title.lower()
            for e in entries
            if e.get("href")
        )
        if not has_drive:
            push({
                "id": f"in_app:{job_id}:{_ascii_fold(title)[:48]}",
                "title": title,
                "channel": "in_app",
                "agent": agent,
                "markdown_preview": body[:400],
            })

    return entries


def build_deliverables_library(limit: int = 200) -> dict[str, Any]:
    from database import list_deliverables_library_rows

    rows = list_deliverables_library_rows(limit=limit)
    flat: list[dict[str, Any]] = []
    for row in rows:
        flat.extend(_entries_from_job(row))

    by_theme: dict[str, list[dict[str, Any]]] = {}
    for item in flat:
        theme = str(item.get("theme") or "Autres livrables")
        by_theme.setdefault(theme, []).append(item)

    theme_order = [t for t, _ in _THEME_RULES] + ["Autres livrables"]
    themes = []
    for label in theme_order:
        items = by_theme.pop(label, [])
        if items:
            themes.append({"theme": label, "count": len(items), "items": items})
    for label, items in sorted(by_theme.items()):
        themes.append({"theme": label, "count": len(items), "items": items})

    return {"total": len(flat), "themes": themes, "items": flat}
