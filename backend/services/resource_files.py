"""Fichiers de ressources planning (vidéo, podcast, document) par workspace."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi.responses import Response

from services.business_db import _new_id, _now, _ws
from workspace_db import _DEFAULT_WORKSPACE_ID


def _uid() -> str:
    try:
        from tenant_context import get_user_id

        return (get_user_id() or "").strip()
    except Exception:
        return ""

MAX_BYTES = 32 * 1024 * 1024
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
        ".mp4",
        ".webm",
        ".mov",
        ".mp3",
        ".m4a",
        ".wav",
        ".ogg",
        ".aac",
    }
)
INLINE_MIME_PREFIXES = (
    "image/",
    "audio/",
    "video/",
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/markdown",
)
BRAND_IMAGE_EXT = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif"})
BRAND_MAX_BYTES = 4 * 1024 * 1024
_FILES_ROOT = Path(__file__).resolve().parents[1] / "data" / "resource-files"


def _safe_filename(name: str) -> str:
    base = Path(name or "fichier").name.strip() or "fichier"
    base = re.sub(r"[^\w.\-àâäéèêëïîôùûüçÉÈÀÙÇ ]+", "_", base, flags=re.IGNORECASE)
    return base[:160] or "fichier"


def download_filename(title: str | None, stored_name: str | None) -> str:
    stored = _safe_filename(stored_name or "fichier")
    ext = Path(stored).suffix
    stem = (title or "").strip()
    if not stem:
        return stored
    if ext and stem.lower().endswith(ext.lower()):
        return _safe_filename(stem)
    return _safe_filename(f"{stem}{ext}")


def _ext_ok(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXT


def files_root() -> Path:
    override = os.environ.get("KORYMB_RESOURCE_FILES_DIR", "").strip()
    return Path(override) if override else _FILES_ROOT


def files_dir(*, workspace_id: str | None = None) -> Path:
    wid = (workspace_id or _ws() or "").strip()
    path = files_root() / wid
    path.mkdir(parents=True, exist_ok=True)
    return path


def content_disposition(filename: str, *, inline: bool = False) -> str:
    name = _safe_filename(filename)
    ascii_name = re.sub(r"[^\w.\-]+", "_", name) or "fichier"
    disp = "inline" if inline else "attachment"
    return f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


def can_inline(mime: str) -> bool:
    m = (mime or "").lower()
    return any(m.startswith(p) for p in INLINE_MIME_PREFIXES)


def save_upload(*, filename: str, mime: str, data: bytes) -> dict[str, Any]:
    name = _safe_filename(filename)
    if not _ext_ok(name):
        return {
            "success": False,
            "error": "Type de fichier non autorisé (PDF, Office, audio, vidéo, images, texte).",
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
    fid = _new_id("rfil")
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
        "user_id": _uid(),
    }
    (folder / f"{fid}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {
        "success": True,
        "file": {k: meta[k] for k in ("id", "filename", "mime", "size", "source") if k in meta},
    }


def local_file_href(file_id: str, *, inline: bool = True) -> str:
    """URL cockpit (proxy binaire) pour ouvrir un fichier du compte workspace."""
    fid = (file_id or "").strip()
    q = "?inline=true" if inline else ""
    return f"/api/korymb-bin/business/resource-files/{fid}{q}"


def save_brand_image(*, filename: str, mime: str, data: bytes) -> dict[str, Any]:
    name = _safe_filename(filename)
    if Path(name).suffix.lower() not in BRAND_IMAGE_EXT:
        return {
            "success": False,
            "error": "Image requise (PNG, JPEG, WebP ou GIF).",
            "status_code": 422,
        }
    if not data:
        return {"success": False, "error": "Fichier vide.", "status_code": 422}
    if len(data) > BRAND_MAX_BYTES:
        return {
            "success": False,
            "error": f"Image trop volumineuse (max {BRAND_MAX_BYTES // (1024 * 1024)} Mo).",
            "status_code": 413,
        }
    return save_upload(filename=name, mime=mime or "image/jpeg", data=data)


def _load_blob(folder: Path, fid: str, *, accept_workspace_ids: set[str]) -> dict[str, Any] | None:
    blob = folder / fid
    if not blob.is_file():
        return None
    meta: dict[str, Any] = {}
    meta_path = folder / f"{fid}.json"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    meta_wid = str(meta.get("workspace_id") or "").strip()
    if meta_wid and meta_wid not in accept_workspace_ids:
        return None
    return {
        "id": fid,
        "filename": str(meta.get("filename") or "fichier"),
        "mime": str(meta.get("mime") or "application/octet-stream"),
        "size": blob.stat().st_size,
        "path": blob,
        "source": "local",
    }


def load_local_file(file_id: str, *, workspace_id: str | None = None) -> dict[str, Any] | None:
    fid = (file_id or "").strip()
    if not fid.startswith("rfil-") or ".." in fid or "/" in fid or "\\" in fid:
        return None
    wid = (workspace_id or _ws() or "").strip()
    accepted = {wid, _DEFAULT_WORKSPACE_ID, ""}
    item = _load_blob(files_dir(workspace_id=wid), fid, accept_workspace_ids=accepted)
    if item:
        return item
    # Jobs lancés dans un thread sans tenant écrivaient dans l'espace legacy.
    if wid != _DEFAULT_WORKSPACE_ID:
        return _load_blob(
            files_dir(workspace_id=_DEFAULT_WORKSPACE_ID),
            fid,
            accept_workspace_ids=accepted,
        )
    return None


def read_file_bytes(file_info: dict[str, Any]) -> bytes:
    path = file_info.get("path")
    if isinstance(path, Path):
        return path.read_bytes()
    return b""


def as_fastapi_response(
    item: dict[str, Any],
    *,
    inline: bool = False,
    download_name: str | None = None,
    public: bool = False,
) -> Response:
    mime = str(item.get("mime") or "application/octet-stream")
    filename = download_name or download_filename(
        str(item.get("event_title") or ""),
        str(item.get("filename") or "fichier"),
    )
    use_inline = bool(inline and can_inline(mime))
    return Response(
        content=read_file_bytes(item),
        media_type=mime or "application/octet-stream",
        headers={
            "Content-Disposition": content_disposition(filename, inline=use_inline),
            "Cache-Control": "public, max-age=300" if public else "private, max-age=120",
            "X-Content-Type-Options": "nosniff",
        },
    )
