"""
Espace Google Drive Korymb — export automatique des livrables opérationnels uniquement.

Seuls les tableaux (→ Google Sheet) et les pièces rédactionnelles type courrier
(→ Google Doc), marquées `#### LIVRABLE — …`, sont déposés sur Drive.
Les synthèses de mission, plans d'action et méta-narration restent dans l'application.
"""
from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from datetime import datetime
from typing import Any

import httpx

from database import (
    append_job_drive_artifacts,
    get_enterprise_memory,
    merge_enterprise_contexts,
)

logger = logging.getLogger(__name__)

_LIVRABLE_BLOCK_RE = re.compile(
    r"^####\s+LIVRABLE\s+—\s+(.+?)\s*$",
    re.MULTILINE | re.IGNORECASE,
)
_FAKE_DRIVE_ID_RE = re.compile(
    r"(1example|1XyZabc|XxXXXXX|XXXXX|abc123|1234567890)",
    re.IGNORECASE,
)
_DRIVE_LINK_RE = re.compile(
    r"\[([^\]]+)\]\((https?://(?:drive|docs)\.google\.com/[^)]+)\)",
    re.IGNORECASE,
)
_META_NARRATIVE_RE = re.compile(
    r"(?i)(je\s+(?:vais|lance|mobilise|vérifie|verifie)|prochaine\s+étape|tâche\s+de\s+fond|"
    r"en\s+arrière.?plan|orchestr|synthèse\s+(?:de\s+)?mission|ce\s+que\s+j.?ai\s+(?:fait|à\s+faire)|"
    r"plan\s+d.?action\s+global|exploration\s+en\s+cours)"
)


def _ascii_fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def markdown_table_to_csv(text: str) -> str | None:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip().startswith("|")]
    if len(lines) < 2:
        return None
    rows: list[list[str]] = []
    for ln in lines:
        if re.match(r"^\|[\s\-:|]+\|$", ln):
            continue
        cells = [c.strip() for c in ln.strip("|").split("|")]
        if cells:
            rows.append(cells)
    if not rows:
        return None
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


def mission_implies_drive_export(blob: str) -> bool:
    """True si la mission demande explicitement un fichier livrable sur Drive."""
    t = _ascii_fold(blob or "")
    hints = (
        "google drive",
        "google sheet",
        "tableau",
        "spreadsheet",
        "fichier csv",
        "sur mon drive",
        "dans mon drive",
        "feuille de calcul",
        "export csv",
        "liste de profils",
    )
    if re.search(r"\b(regener|regenere|regénère)\b", t) and re.search(r"\b(tableau|fichier|csv|sheet)\b", t):
        return True
    if "livrable" in t and re.search(r"\b(tableau|courrier|lettre|mail|csv|fichier)\b", t):
        return True
    return any(h in t for h in hints)


def _has_markdown_table(text: str) -> bool:
    return markdown_table_to_csv(text or "") is not None


def _looks_like_letter(text: str) -> bool:
    t = _ascii_fold((text or "")[:1500])
    strong = ("objet:", "madame,", "madame ", "monsieur,", "monsieur ", "cher ", "chere ", "chère ")
    if "objet:" in t and len((text or "").strip()) > 60:
        return True
    return sum(1 for h in strong if h in t) >= 2


def _looks_like_planning_only(body: str) -> bool:
    t = _ascii_fold(body or "")
    if _looks_like_letter(body) or _has_markdown_table(body):
        return False
    planning = (
        "je vais",
        "prochaine etape",
        "prochaine étape",
        "etape 1",
        "orchestration",
        "en arriere-plan",
        "en arrière-plan",
        "mobilise l'agent",
        "je lance l",
    )
    return sum(1 for p in planning if p in t) >= 2


def is_meta_narrative_deliverable(title: str, body: str) -> bool:
    title_fold = _ascii_fold(title or "")
    if title_fold.startswith("synthese") or title_fold.startswith("synthèse"):
        return True
    if _META_NARRATIVE_RE.search((body or "")[:900]) and not _looks_like_letter(body):
        return True
    if _looks_like_planning_only(body):
        return True
    return False


def extract_table_only(body: str) -> str | None:
    lines = (body or "").splitlines()
    table_lines = [ln for ln in lines if ln.strip().startswith("|")]
    if len(table_lines) < 2:
        return None
    return "\n".join(table_lines).strip()


def infer_drive_format(title: str, body: str) -> str:
    if _has_markdown_table(body):
        return "sheet"
    if _looks_like_letter(body):
        return "doc"
    return "doc"


def extract_exportable_content(title: str, body: str) -> tuple[str, str] | None:
    """
    Retourne (contenu, format_kind) si la pièce mérite un fichier Drive, sinon None.
    Uniquement tableaux ou courriers / pièces rédactionnelles explicites.
    """
    body = (body or "").strip()
    title = (title or "").strip()
    if not body or is_meta_narrative_deliverable(title, body):
        return None

    table = extract_table_only(body)
    if table:
        return table, "sheet"
    if _looks_like_letter(body):
        return body, "doc"
    # Pièce LIVRABLE courte (post, script) : Doc si contenu actionnable, pas un plan.
    if len(body) >= 80 and not _looks_like_planning_only(body):
        blob = _ascii_fold(f"{title}\n{body[:400]}")
        if not any(x in blob for x in ("synthese mission", "bilan operationnel", "recommandation strategique")):
            return body, "doc"
    return None


def parse_livrable_blocks(text: str) -> list[dict[str, str]]:
    if not (text or "").strip():
        return []
    matches = list(_LIVRABLE_BLOCK_RE.finditer(text))
    if not matches:
        return []
    out: list[dict[str, str]] = []
    for i, m in enumerate(matches):
        title = (m.group(1) or "").strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if title and body:
            out.append({"title": title, "body": body})
    return out


def _slug_filename(title: str, max_len: int = 80) -> str:
    s = re.sub(r"[^\w\s\-àâäéèêëïîôùûüçœæ\-]", "", title or "", flags=re.IGNORECASE)
    s = re.sub(r"\s+", "_", s.strip())
    return (s[:max_len] or "Livrable_Korymb").strip("_")


def _parse_upload_result(raw: str) -> dict[str, str] | None:
    if not raw or "Fichier Drive créé" not in raw:
        return None
    m_id = re.search(r"\(id:\s*([^)]+)\)", raw)
    m_link = re.search(r"(https://(?:drive|docs)\.google\.com/\S+)", raw)
    m_name = re.search(r"Fichier Drive créé\s*:\s*([^\n(]+)", raw)
    if not m_id:
        return None
    return {
        "id": m_id.group(1).strip(),
        "name": (m_name.group(1).strip() if m_name else "Livrable"),
        "webViewLink": (m_link.group(1).strip() if m_link else ""),
    }


def _existing_drive_ids_from_events(events: list | None) -> set[str]:
    ids: set[str] = set()
    if not isinstance(events, list):
        return ids
    for e in events:
        if not isinstance(e, dict):
            continue
        if e.get("type") != "tool_call":
            continue
        pl = e.get("payload") or {}
        if pl.get("tool") not in ("upload_google_drive", "create_drive_deliverable"):
            continue
        preview = str(pl.get("preview") or "")
        parsed = _parse_upload_result(preview)
        if parsed and parsed.get("id"):
            ids.add(parsed["id"])
    return ids


def resolve_workspace_folder_id() -> str:
    """Dossier Drive Korymb : env > mémoire > recherche/création automatique."""
    env_id = str(os.getenv("GOOGLE_DRIVE_FOLDER_ID", "") or "").strip()
    if env_id:
        return env_id
    try:
        mem = get_enterprise_memory()
        ws = (mem.get("contexts") or {}).get("drive_workspace")
        if isinstance(ws, str):
            ws = json.loads(ws) if ws.strip().startswith("{") else {}
        if isinstance(ws, dict):
            fid = str(ws.get("default_folder_id") or "").strip()
            if fid:
                return fid
    except Exception:
        pass
    from tools import _get_google_drive_token

    token = _get_google_drive_token()
    if not token:
        return ""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        q = "name='Korymb' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        r = httpx.get(
            "https://www.googleapis.com/drive/v3/files",
            params={"q": q, "fields": "files(id,name)", "pageSize": 1},
            headers=headers,
            timeout=20,
        )
        r.raise_for_status()
        files = (r.json() or {}).get("files") or []
        if files:
            fid = str(files[0].get("id") or "")
            if fid:
                _persist_folder_id(fid)
                return fid
        meta = json.dumps({"name": "Korymb", "mimeType": "application/vnd.google-apps.folder"})
        r2 = httpx.post(
            "https://www.googleapis.com/drive/v3/files",
            headers={**headers, "Content-Type": "application/json"},
            content=meta,
            timeout=20,
        )
        r2.raise_for_status()
        fid = str((r2.json() or {}).get("id") or "")
        if fid:
            _persist_folder_id(fid)
        return fid
    except Exception:
        logger.exception("resolve_workspace_folder_id")
        return ""


def _persist_folder_id(folder_id: str) -> None:
    try:
        mem = get_enterprise_memory()
        ws_raw = (mem.get("contexts") or {}).get("drive_workspace")
        ws: dict[str, Any] = {}
        if isinstance(ws_raw, str) and ws_raw.strip().startswith("{"):
            ws = json.loads(ws_raw)
        elif isinstance(ws_raw, dict):
            ws = dict(ws_raw)
        ws["default_folder_id"] = folder_id
        ws["folder_name"] = "Korymb"
        ws["updated_at"] = datetime.utcnow().isoformat()
        merge_enterprise_contexts({"drive_workspace": json.dumps(ws, ensure_ascii=False)})
    except Exception:
        logger.exception("_persist_folder_id")


def _register_in_memory(artifacts: list[dict[str, Any]], mission_preview: str) -> None:
    if not artifacts:
        return
    try:
        mem = get_enterprise_memory()
        ws_raw = (mem.get("contexts") or {}).get("drive_workspace")
        ws: dict[str, Any] = {"files": [], "default_folder_id": resolve_workspace_folder_id()}
        if isinstance(ws_raw, str) and ws_raw.strip().startswith("{"):
            ws = json.loads(ws_raw)
        elif isinstance(ws_raw, dict):
            ws = dict(ws_raw)
        files = list(ws.get("files") or [])
        now = datetime.utcnow().isoformat()
        for a in artifacts:
            files.append({
                "id": a.get("id"),
                "name": a.get("name"),
                "url": a.get("webViewLink"),
                "kind": a.get("kind"),
                "job_id": a.get("job_id"),
                "mission": (mission_preview or "")[:200],
                "ts": now,
            })
        ws["files"] = files[-50:]
        ws["updated_at"] = now
        merge_enterprise_contexts({"drive_workspace": json.dumps(ws, ensure_ascii=False)})
    except Exception:
        logger.exception("_register_in_memory")


def build_drive_workspace_memory_prompt() -> str:
    try:
        mem = get_enterprise_memory()
        ws_raw = (mem.get("contexts") or {}).get("drive_workspace")
        if not ws_raw:
            return ""
        ws = json.loads(ws_raw) if isinstance(ws_raw, str) else ws_raw
        if not isinstance(ws, dict):
            return ""
        files = ws.get("files") or []
        if not files:
            return ""
        lines = ["", "--- Espace Google Drive Korymb (fichiers récents) ---"]
        fid = str(ws.get("default_folder_id") or "").strip()
        if fid:
            lines.append(f"Dossier racine Korymb (id: {fid}).")
        for f in files[-12:]:
            name = f.get("name") or "?"
            url = f.get("url") or ""
            mission = f.get("mission") or ""
            if url:
                lines.append(f"- {name} : {url}" + (f" — {mission[:80]}" if mission else ""))
        lines.append(
            "Les livrables fichiers sont déposés automatiquement ici par Korymb. "
            "Ne cite jamais de lien Drive inventé — uniquement ceux listés ci-dessus ou retournés par un outil."
        )
        return "\n".join(lines)
    except Exception:
        return ""


def strip_fabricated_drive_links(text: str) -> str:
    if not text:
        return text

    def _repl(m: re.Match[str]) -> str:
        url = m.group(2) or ""
        if _FAKE_DRIVE_ID_RE.search(url):
            return m.group(1)
        if "remplacer" in (m.group(0) or "").lower():
            return m.group(1)
        return m.group(0)

    out = _DRIVE_LINK_RE.sub(_repl, text)
    out = re.sub(
        r"\*?\(remplacer[^)]*\)\*?",
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"\*?\(lien réel[^)]*\)\*?",
        "",
        out,
        flags=re.IGNORECASE,
    )
    return out.strip()


def _append_drive_section(text: str, artifacts: list[dict[str, Any]]) -> str:
    if not artifacts:
        return text
    lines = ["", "---", "", "## Fichiers Google Drive (Korymb)", ""]
    for a in artifacts:
        name = a.get("name") or "Livrable"
        url = a.get("webViewLink") or ""
        kind = a.get("kind") or "fichier"
        if url:
            lines.append(f"- **{name}** ({kind}) : [{name}]({url})")
        else:
            lines.append(f"- **{name}** ({kind}) — id: `{a.get('id')}`")
    lines.append("")
    lines.append("*Déposés automatiquement dans votre espace Drive Korymb.*")
    base = (text or "").rstrip()
    return base + "\n" + "\n".join(lines) if base else "\n".join(lines)


def _collect_export_candidates(
    *,
    mission_txt: str,
    root_mission_label: str,
    resultats: dict[str, str],
    synthesis: str,
    events: list | None,
) -> list[dict[str, str]]:
    existing = _existing_drive_ids_from_events(events)
    candidates: list[dict[str, str]] = []
    seen_titles: set[str] = set()

    def add(title: str, body: str, agent: str = "coordinateur") -> None:
        extracted = extract_exportable_content(title, body)
        if not extracted:
            return
        export_body, format_kind = extracted
        t = _slug_filename(title)
        if not export_body.strip() or t in seen_titles:
            return
        if _parse_upload_result(export_body):
            return
        seen_titles.add(t)
        candidates.append({
            "title": title.strip() or t,
            "body": export_body.strip(),
            "agent": agent,
            "format_kind": format_kind,
        })

    for ag, txt in (resultats or {}).items():
        for block in parse_livrable_blocks(txt or ""):
            add(block["title"], block["body"], ag)

    for block in parse_livrable_blocks(synthesis or ""):
        add(block["title"], block["body"])

    if existing:
        return candidates
    return candidates


def finalize_mission_drive_deliverables(
    *,
    job_id: str | None,
    mission_txt: str,
    root_mission_label: str,
    resultats: dict[str, str],
    synthesis: str,
    events: list | None,
    job_logs: list[str] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """
    Exporte automatiquement les livrables sur Drive, nettoie les liens fictifs,
    enrichit la synthèse avec les vrais liens.
    """
    from tools import run_create_drive_deliverable

    def log(msg: str) -> None:
        if job_logs is not None:
            job_logs.append(msg)

    cleaned = strip_fabricated_drive_links(synthesis or "")
    existing_ids = _existing_drive_ids_from_events(events)
    if existing_ids:
        log(f"[korymb] Drive : {len(existing_ids)} fichier(s) déjà créé(s) via outils — export auto complémentaire.")
    candidates = _collect_export_candidates(
        mission_txt=mission_txt,
        root_mission_label=root_mission_label,
        resultats=resultats,
        synthesis=cleaned,
        events=events,
    )
    blob = f"{mission_txt}\n{root_mission_label}"
    if not candidates and not mission_implies_drive_export(blob):
        return cleaned, []

    folder_id = resolve_workspace_folder_id()
    artifacts: list[dict[str, Any]] = []
    for c in candidates[:6]:
        title = c["title"]
        body = c["body"]
        fmt = c.get("format_kind") or infer_drive_format(title, body)
        raw = run_create_drive_deliverable(title, body, format_kind=fmt, folder_id=folder_id)
        parsed = _parse_upload_result(raw)
        if not parsed:
            log(f"[korymb] Drive auto-export échec pour « {title[:60]} » : {raw[:180]}")
            continue
        kind = "sheet" if fmt == "sheet" else "doc" if fmt == "doc" else "fichier"
        art = {
            **parsed,
            "kind": kind,
            "agent": c.get("agent") or "coordinateur",
            "job_id": job_id,
        }
        artifacts.append(art)
        log(f"[korymb] Drive auto-export : {art.get('name')} → {art.get('webViewLink') or art.get('id')}")

    if not artifacts and mission_implies_drive_export(blob):
        log("[korymb] Drive : mission avec livrable fichier attendu mais export auto impossible (vérifiez OAuth Drive).")

    if artifacts and job_id:
        try:
            append_job_drive_artifacts(job_id, artifacts)
        except Exception:
            logger.exception("append_job_drive_artifacts")

    preview = (root_mission_label or mission_txt or "")[:200]
    _register_in_memory(artifacts, preview)

    if artifacts:
        cleaned = _append_drive_section(cleaned, artifacts)
    return cleaned, artifacts
