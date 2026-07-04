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

_DRIVE_FILE_ID_RE = re.compile(
    r"/(?:file|spreadsheets|document)/d/([a-zA-Z0-9_-]+)",
    re.IGNORECASE,
)

_MARKDOWN_NOISE_RE = re.compile(
    r"(\*\*Fichiers Google Drive \(Korymb\)\*\*|\[.*?\]\(https?://[^\)]+\)|#{1,6}\s+)",
    re.IGNORECASE,
)


def _extract_drive_file_id(href: str) -> str:
    m = _DRIVE_FILE_ID_RE.search(href or "")
    return m.group(1) if m else ""


def _normalize_drive_href(href: str) -> str:
    fid = _extract_drive_file_id(href)
    if not fid:
        return (href or "").strip().split("?")[0]
    if "spreadsheets" in (href or ""):
        return f"https://docs.google.com/spreadsheets/d/{fid}"
    if "document" in (href or ""):
        return f"https://docs.google.com/document/d/{fid}"
    return f"https://drive.google.com/file/d/{fid}"


def _title_fingerprint(title: str) -> str:
    return _ascii_fold(title or "").replace("livrable", "").strip()[:64]


def _plain_text_excerpt(text: str, max_len: int = 320) -> str:
    raw = str(text or "")
    raw = _MARKDOWN_NOISE_RE.sub(" ", raw)
    raw = re.sub(r"\|", " ", raw)
    raw = re.sub(r"[-]{3,}", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    if len(raw) <= max_len:
        return raw
    cut = raw[: max_len - 1].rsplit(" ", 1)[0]
    return (cut or raw[:max_len]).strip() + "…"


def _content_hint(channel: str, preview: str = "", title: str = "") -> str:
    ch = str(channel or "")
    preview = str(preview or "")
    if ch == "drive_sheet" or title.lower().endswith(".csv"):
        rows = max(0, preview.count("\n") - 1) if "|" in preview else 0
        return f"Tableau Google Sheet{f' · ~{rows} lignes' if rows else ''}"
    if ch == "drive_doc":
        return "Document Google Doc"
    if ch == "drive_file":
        return "Fichier Google Drive"
    if "|" in preview and "---" in preview:
        rows = max(0, len([ln for ln in preview.splitlines() if ln.strip().startswith("|")]) - 2)
        return f"Contenu structuré · ~{rows} lignes"
    words = len(_plain_text_excerpt(preview, 5000).split())
    if words > 40:
        return f"Texte · ~{words} mots"
    return "Contenu dans Korymb"


def _build_deliverable_description(
    *,
    title: str,
    channel: str,
    mission: str = "",
    preview: str = "",
    source: str = "",
) -> str:
    parts: list[str] = []
    hint = _content_hint(channel, preview, title)
    if hint:
        parts.append(hint + ".")
    excerpt = _plain_text_excerpt(preview, 280)
    if excerpt:
        parts.append(excerpt)
    elif mission:
        parts.append(_plain_text_excerpt(mission, 200))
    src = str(source or "").lower()
    if src == "chat":
        parts.append("Produit depuis une conversation chat.")
    elif src in ("scheduler", "autonomous"):
        parts.append("Produit en mode autonomie.")
    else:
        parts.append("Produit depuis une mission.")
    return " ".join(p for p in parts if p).strip()


def _titles_related(title_a: str, title_b: str) -> bool:
    a = _title_fingerprint(title_a)
    b = _title_fingerprint(title_b)
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) >= 8 and len(b) >= 8 and (a in b or b in a):
        return True
    return False


def _consolidation_key_for_item(item: dict[str, Any], job_drive_keys: dict[str, list[str]], buckets: dict[str, dict]) -> str:
    job_id = str(item.get("job_id") or "")
    channel = str(item.get("channel") or "")
    href = str(item.get("href") or "").strip()
    if href:
        fid = _extract_drive_file_id(href)
        if fid:
            return f"drive:{fid}"
    if channel == "in_app" and job_id:
        drive_keys = job_drive_keys.get(job_id) or []
        if len(drive_keys) == 1:
            return drive_keys[0]
        title = str(item.get("title") or "")
        for drive_key in drive_keys:
            drive = buckets.get(drive_key) or {}
            if _titles_related(title, str(drive.get("title") or "")):
                return drive_key
    if channel == "in_app":
        return f"in_app:{job_id}:{_title_fingerprint(str(item.get('title') or ''))}"
    return f"solo:{_library_canonical_item_id(str(item.get('id') or ''))}"


def _merge_source(existing: list[dict[str, Any]], item: dict[str, Any]) -> list[dict[str, Any]]:
    job_id = str(item.get("job_id") or "")
    if not job_id:
        return existing
    for row in existing:
        if str(row.get("job_id") or "") == job_id:
            return existing
    return existing + [
        {
            "job_id": job_id,
            "mission": str(item.get("mission") or "")[:500],
            "created_at": str(item.get("created_at") or ""),
            "job_href": str(item.get("job_href") or ""),
            "source": str(item.get("source") or "mission"),
            "agent": str(item.get("agent") or ""),
        }
    ]


def _access_point_dedupe_key(point: dict[str, Any]) -> str:
    channel = str(point.get("channel") or "")
    href = str(point.get("href") or "").strip()
    job_href = str(point.get("job_href") or "").strip()
    if channel.startswith("drive_") and href:
        fid = _extract_drive_file_id(href)
        return f"drive:{fid or _normalize_drive_href(href)}"
    if channel == "in_app":
        anchor = str(point.get("anchor") or _ascii_fold(str(point.get("label") or ""))[:48])
        return f"in_app:{job_href}:{anchor}"
    return f"{channel}:{href or job_href}"


def _merge_access_point(points: list[dict[str, Any]], item: dict[str, Any]) -> list[dict[str, Any]]:
    channel = str(item.get("channel") or "")
    href = str(item.get("href") or "").strip()
    job_href = str(item.get("job_href") or "").strip()
    title = str(item.get("title") or "")
    point: dict[str, Any] = {"channel": channel, "label": title}
    if href:
        point["href"] = href
    if job_href:
        point["job_href"] = job_href
    if channel == "in_app":
        point["anchor"] = f"livrable-{_ascii_fold(title)[:48] or 'livrable'}"
    key = _access_point_dedupe_key(point)
    if any(_access_point_dedupe_key(p) == key for p in points):
        return points
    point["_key"] = key
    return points + [point]


def _finalize_access_points(group: dict[str, Any]) -> list[dict[str, Any]]:
    """Un bouton principal par canal : Drive prioritaire, pas de doublon href."""
    raw = list(group.get("access_points") or [])
    by_key: dict[str, dict[str, Any]] = {}
    for point in raw:
        by_key[_access_point_dedupe_key(point)] = point

    drive_pts = [p for p in by_key.values() if str(p.get("channel") or "").startswith("drive_")]
    in_app_pts = [p for p in by_key.values() if str(p.get("channel") or "") == "in_app"]

    if drive_pts:
        # Fichier Drive = accès principal ; le contenu in-app du même job est redondant.
        chosen = [drive_pts[0]]
    elif in_app_pts:
        chosen = [in_app_pts[0]]
    else:
        chosen = list(by_key.values())[:1]

    for p in chosen:
        p.pop("_key", None)
    return chosen


def _consolidate_library_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Regroupe doublons (même fichier Drive, même titre in-app) et enrichit les descriptions."""
    buckets: dict[str, dict[str, Any]] = {}
    job_drive_keys: dict[str, list[str]] = {}

    for item in items:
        href = str(item.get("href") or "").strip()
        if href:
            fid = _extract_drive_file_id(href)
            if fid:
                key = f"drive:{fid}"
                job_id = str(item.get("job_id") or "")
                if job_id:
                    job_drive_keys.setdefault(job_id, [])
                    if key not in job_drive_keys[job_id]:
                        job_drive_keys[job_id].append(key)

    ordered = sorted(
        items,
        key=lambda x: (0 if str(x.get("channel") or "").startswith("drive_") else 1, str(x.get("created_at") or "")),
    )

    for item in ordered:
        key = _consolidation_key_for_item(item, job_drive_keys, buckets)
        row = dict(item)
        member_id = _library_canonical_item_id(str(row.get("id") or ""))

        if key not in buckets:
            buckets[key] = {
                **row,
                "id": f"group:{key}",
                "member_ids": [member_id],
                "sources": _merge_source([], row),
                "access_points": _merge_access_point([], row),
                "source_count": 1,
            }
            continue

        group = buckets[key]
        group["member_ids"] = sorted(set(group.get("member_ids") or []) | {member_id})
        group["sources"] = _merge_source(list(group.get("sources") or []), row)
        group["access_points"] = _merge_access_point(list(group.get("access_points") or []), row)
        group["source_count"] = len(group["sources"])

        cur_preview = str(group.get("markdown_preview") or "")
        new_preview = str(row.get("markdown_preview") or "")
        if len(new_preview) > len(cur_preview):
            group["markdown_preview"] = new_preview

        cur_created = str(group.get("created_at") or "")
        new_created = str(row.get("created_at") or "")
        if new_created > cur_created:
            group["created_at"] = new_created
            group["job_id"] = row.get("job_id")
            group["job_href"] = row.get("job_href")
            group["mission"] = row.get("mission")
            group["source"] = row.get("source")

        if str(row.get("channel") or "").startswith("drive_"):
            group["channel"] = row.get("channel")
            group["href"] = _normalize_drive_href(str(row.get("href") or "")) or row.get("href")
            if len(str(row.get("title") or "")) > len(str(group.get("title") or "")):
                group["title"] = row.get("title")

    out: list[dict[str, Any]] = []
    for group in buckets.values():
        preview = str(group.get("markdown_preview") or "")
        channel = str(group.get("channel") or "in_app")
        title = str(group.get("title") or "Livrable")
        mission = str(group.get("mission") or "")
        source = str(group.get("source") or "")
        group["content_hint"] = _content_hint(channel, preview, title)
        group["description"] = _build_deliverable_description(
            title=title,
            channel=channel,
            mission=mission,
            preview=preview,
            source=source,
        )
        group["access_points"] = _finalize_access_points(group)
        if group.get("source_count", 1) > 1:
            group["description"] = (
                f"{group['description']} Présent dans {group['source_count']} missions distinctes."
            ).strip()
        out.append(group)

    out.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return out


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
    seen_entry_ids: set[str] = set()

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
        entry_id = str(entry.get("id") or "").strip()
        if entry_id:
            if entry_id in seen_entry_ids:
                return
            seen_entry_ids.add(entry_id)
        href = str(entry.get("href") or "").strip()
        title = str(entry.get("title") or "").strip()
        if href and href in seen_href:
            return
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
                "id": f"drive:{job_id}:{art.get('id') or href}",
                "title": name,
                "channel": _drive_channel(str(art.get("kind") or ""), name),
                "href": href,
                "agent": str(art.get("agent") or agent),
            })

    for m in _DRIVE_LINK_RE.finditer(result):
        title, href = m.group(1).strip(), m.group(2).strip()
        ch = "drive_sheet" if "spreadsheets" in href else "drive_doc" if "document" in href else "drive_file"
        push({"id": f"mdlink:{job_id}:{href}", "title": title, "channel": ch, "href": href, "agent": agent})

    for idx, block in enumerate(parse_livrable_blocks(result)):
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
            slug = _ascii_fold(title)[:48] or "livrable"
            push({
                "id": f"in_app:{job_id}:{slug}:{idx}",
                "title": title,
                "channel": "in_app",
                "agent": agent,
                "markdown_preview": body[:800],
            })

    return entries


def _library_canonical_item_id(item_id: str) -> str:
    return re.sub(r"#\d+$", "", (item_id or "").strip())


def _flat_library_items(limit: int = 400) -> list[dict[str, Any]]:
    from database import list_deliverables_library_rows

    rows = list_deliverables_library_rows(limit=limit)
    flat: list[dict[str, Any]] = []
    for row in rows:
        flat.extend(_entries_from_job(row))
    return _ensure_unique_library_items(flat)


def resolve_library_group_id(item_id: str, *, limit: int = 400) -> str:
    """Résout l'identifiant de carte regroupée à masquer."""
    iid = (item_id or "").strip()
    if iid.startswith("group:"):
        return iid
    canonical = _library_canonical_item_id(iid)
    for group in _consolidate_library_items(_flat_library_items(limit=limit)):
        gid = str(group.get("id") or "")
        members = {str(m) for m in (group.get("member_ids") or []) if m}
        if gid == iid or iid in members or canonical in members:
            return gid
    return iid


def collect_library_dismiss_targets(item_id: str, *, limit: int = 400) -> list[str]:
    """ID de carte à masquer (format group: uniquement)."""
    return [resolve_library_group_id(item_id, limit=limit)]


def _ensure_unique_library_items(flat: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Garantit des ids stables et uniques pour le rendu React (même job, titres proches)."""
    seen: dict[str, int] = {}
    out: list[dict[str, Any]] = []
    for item in flat:
        row = dict(item)
        job_id = str(row.get("job_id") or "")
        base_id = str(row.get("id") or "")
        uid = f"{job_id}:{base_id}"
        n = seen.get(uid, 0)
        if n:
            row["id"] = f"{base_id}#{n}"
        seen[uid] = n + 1
        out.append(row)
    return out


def _maybe_prune_legacy_library_dismissals() -> None:
    from database import list_library_dismissed_item_ids, prune_legacy_library_member_dismissals

    if any(not x.startswith("group:") for x in list_library_dismissed_item_ids()):
        removed = prune_legacy_library_member_dismissals()
        if removed:
            import logging

            logging.getLogger(__name__).info(
                "Bibliothèque livrables : %s masquage(s) membre obsolète(s) retiré(s).", removed
            )


def build_deliverables_library(limit: int = 200) -> dict[str, Any]:
    from database import list_library_dismissed_group_ids

    _maybe_prune_legacy_library_dismissals()
    dismissed_groups = list_library_dismissed_group_ids()
    flat = _flat_library_items(limit=limit)
    raw_total = len(flat)

    consolidated = _consolidate_library_items(flat)
    if dismissed_groups:
        consolidated = [group for group in consolidated if str(group.get("id") or "") not in dismissed_groups]

    by_theme: dict[str, list[dict[str, Any]]] = {}
    for item in consolidated:
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

    return {
        "total": len(consolidated),
        "raw_total": raw_total,
        "themes": themes,
        "items": consolidated,
    }
