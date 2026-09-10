"""Stockage local des pièces jointes e-mail (envoi HITL) et lecture Gmail."""
from __future__ import annotations

import json
import os
import re
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import quote

from services.business_db import _new_id, _now, _ws

MAX_FILES = 5
MAX_BYTES = 8 * 1024 * 1024
ALLOWED_EXT = frozenset(
    {
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".txt",
        ".csv",
        ".md",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".odt",
        ".ods",
        ".odp",
    }
)
INLINE_MIME_PREFIXES = ("image/", "application/pdf", "text/plain", "text/csv")

_FILES_ROOT = Path(__file__).resolve().parents[1] / "data" / "mail-files"


def _safe_filename(name: str) -> str:
    base = Path(name or "fichier").name.strip() or "fichier"
    base = re.sub(r"[^\w.\-àâäéèêëïîôùûüçÉÈÀÙÇ ]+", "_", base, flags=re.IGNORECASE)
    return base[:160] or "fichier"


def _ext_ok(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT


def files_root() -> Path:
    override = os.environ.get("KORYMB_MAIL_FILES_DIR", "").strip()
    return Path(override) if override else _FILES_ROOT


def files_dir() -> Path:
    path = files_root() / _ws()
    path.mkdir(parents=True, exist_ok=True)
    return path


def serialize_attachments(items: list[dict] | None) -> str:
    clean: list[dict] = []
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        att_id = str(raw.get("id") or "").strip()
        filename = _safe_filename(str(raw.get("filename") or "fichier"))
        if not att_id:
            continue
        clean.append(
            {
                "id": att_id[:191],
                "filename": filename,
                "mime": str(raw.get("mime") or "application/octet-stream")[:160],
                "size": int(raw.get("size") or 0),
                "source": str(raw.get("source") or "local")[:20],
                "gmail_attachment_id": str(raw.get("gmail_attachment_id") or "")[:500],
            }
        )
    return json.dumps(clean, ensure_ascii=False)


def parse_attachments(raw: Any) -> list[dict]:
    if isinstance(raw, list):
        data = raw
    else:
        try:
            data = json.loads(raw or "[]")
        except Exception:
            data = []
    if not isinstance(data, list):
        return []
    out: list[dict] = []
    for item in data:
        if isinstance(item, dict) and item.get("id"):
            out.append(item)
    return out


def save_upload(*, filename: str, mime: str, data: bytes) -> dict[str, Any]:
    name = _safe_filename(filename)
    if not _ext_ok(name):
        return {
            "success": False,
            "error": "Type de fichier non autorisé (PDF, images, Office, texte).",
            "status_code": 422,
        }
    if not data:
        return {"success": False, "error": "Fichier vide.", "status_code": 422}
    if len(data) > MAX_BYTES:
        return {
            "success": False,
            "error": f"Fichier trop volumineux (max {MAX_BYTES // (1024 * 1024)} Mo).",
            "status_code": 413,
        }
    fid = _new_id("efil")
    folder = files_dir()
    (folder / fid).write_bytes(data)
    meta = {
        "id": fid,
        "filename": name,
        "mime": (mime or "application/octet-stream")[:160],
        "size": len(data),
        "source": "local",
        "created_at": _now(),
        "workspace_id": _ws(),
    }
    (folder / f"{fid}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"success": True, "file": {k: meta[k] for k in ("id", "filename", "mime", "size", "source")}}


def load_local_file(file_id: str) -> dict[str, Any] | None:
    fid = (file_id or "").strip()
    if not fid.startswith("efil-") or ".." in fid or "/" in fid or "\\" in fid:
        return None
    folder = files_dir()
    blob = folder / fid
    meta_path = folder / f"{fid}.json"
    if not blob.is_file():
        return None
    meta: dict[str, Any] = {}
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    if str(meta.get("workspace_id") or _ws()) != _ws():
        return None
    return {
        "id": fid,
        "filename": str(meta.get("filename") or "fichier"),
        "mime": str(meta.get("mime") or "application/octet-stream"),
        "size": blob.stat().st_size,
        "path": blob,
        "source": "local",
    }


def load_local_files(ids: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw_id in ids:
        item = load_local_file(str(raw_id or ""))
        if item:
            out.append(item)
    return out


def payload_attachments_from_ids(ids: list[str]) -> list[dict[str, Any]]:
    files = load_local_files(ids)
    return [
        {
            "id": f["id"],
            "filename": f["filename"],
            "mime": f["mime"],
            "size": f["size"],
            "source": "local",
        }
        for f in files
    ]


def read_file_bytes(file_info: dict[str, Any]) -> bytes:
    path = file_info.get("path")
    if isinstance(path, Path):
        return path.read_bytes()
    return b""


def can_inline(mime: str) -> bool:
    m = (mime or "").lower()
    return any(m.startswith(p) for p in INLINE_MIME_PREFIXES)


def resolve_message_attachment(message: dict, att_id: str) -> dict[str, Any] | None:
    wanted = (att_id or "").strip()
    for item in parse_attachments(message.get("attachments")):
        if str(item.get("id") or "") == wanted:
            return item
    return None


def content_disposition(filename: str, *, inline: bool = False) -> str:
    name = _safe_filename(filename)
    ascii_name = re.sub(r"[^\w.\-]+", "_", name) or "fichier"
    disp = "inline" if inline else "attachment"
    return f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


def resolve_attachment_bytes(item: dict[str, Any]) -> bytes:
    raw = item.get("data")
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    path = item.get("path")
    if isinstance(path, Path) and path.is_file():
        return path.read_bytes()
    local = load_local_file(str(item.get("id") or ""))
    if local:
        return read_file_bytes(local)
    return b""


def build_email_message(
    *,
    to: str,
    subject: str,
    body: str,
    attachments: list[dict[str, Any]] | None = None,
    in_reply_to: str = "",
    references: str = "",
    message_id: str = "",
    from_addr: str = "",
) -> EmailMessage:
    msg = EmailMessage()
    msg["To"] = (to or "").strip()
    msg["Subject"] = (subject or "").strip()
    if from_addr:
        msg["From"] = from_addr
    if message_id:
        msg["Message-ID"] = message_id
    reply_to = (in_reply_to or "").strip()
    if reply_to:
        msg["In-Reply-To"] = reply_to
        msg["References"] = (references or reply_to).strip()
    msg.set_content((body or "").strip() or " ")
    for item in attachments or []:
        data = resolve_attachment_bytes(item)
        if not data:
            continue
        filename = _safe_filename(str(item.get("filename") or "fichier"))
        mime = str(item.get("mime") or "application/octet-stream")
        main, _, sub = mime.partition("/")
        msg.add_attachment(
            data,
            maintype=(main or "application"),
            subtype=(sub or "octet-stream"),
            filename=filename,
        )
    return msg


def load_attachment_payload(message: dict, att_meta: dict) -> dict[str, Any]:
    """Charge les octets d'une PJ (disque local ou Gmail)."""
    filename = _safe_filename(str(att_meta.get("filename") or "fichier"))
    mime = str(att_meta.get("mime") or "application/octet-stream")
    source = str(att_meta.get("source") or "")
    local = load_local_file(str(att_meta.get("id") or ""))
    if local:
        return {
            "success": True,
            "filename": local["filename"],
            "mime": local["mime"],
            "data": read_file_bytes(local),
        }
    gmail_att = str(att_meta.get("gmail_attachment_id") or "").strip()
    gmail_mid = str(message.get("gmail_message_id") or "").strip()
    if source == "gmail" or gmail_att:
        if not gmail_mid or not gmail_att:
            return {"success": False, "error": "Pièce jointe Gmail incomplète.", "status_code": 404}
        try:
            from tools.google_api import fetch_gmail_attachment_bytes

            data = fetch_gmail_attachment_bytes(gmail_mid, gmail_att)
        except Exception as exc:
            return {"success": False, "error": f"Téléchargement Gmail impossible : {exc}", "status_code": 502}
        if not data:
            return {"success": False, "error": "Pièce jointe Gmail vide ou introuvable.", "status_code": 404}
        return {"success": True, "filename": filename, "mime": mime, "data": data}
    return {"success": False, "error": "Pièce jointe introuvable.", "status_code": 404}
