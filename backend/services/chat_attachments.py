"""Pièces jointes du chat dirigeant : extraction texte et description d'image."""
from __future__ import annotations

import base64
import io
import logging
import os
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)

MAX_ATTACHMENTS = 6
MAX_EXCERPT_CHARS = 8_000
MAX_TOTAL_CHARS = 24_000
MAX_VISION_BYTES = 4 * 1024 * 1024


def normalize_attachment_refs(raw: list[Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        fid = str(item.get("id") or "").strip()
        if not fid.startswith("rfil-") or fid in seen:
            continue
        seen.add(fid)
        out.append(
            {
                "id": fid,
                "filename": str(item.get("filename") or "")[:160],
                "mime": str(item.get("mime") or "")[:160],
                "size": int(item.get("size") or 0),
            }
        )
        if len(out) >= MAX_ATTACHMENTS:
            break
    return out


def load_resolved_attachments(refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from services.resource_files import load_local_file, read_file_bytes

    resolved: list[dict[str, Any]] = []
    for ref in refs:
        item = load_local_file(str(ref.get("id") or ""))
        if not item:
            continue
        try:
            data = read_file_bytes(item)
        except Exception:
            logger.exception("chat attachment read %s", ref.get("id"))
            data = b""
        resolved.append(
            {
                "id": item.get("id"),
                "filename": str(item.get("filename") or ref.get("filename") or "fichier"),
                "mime": str(item.get("mime") or ref.get("mime") or "application/octet-stream"),
                "size": int(item.get("size") or len(data) or 0),
                "data": data,
            }
        )
    return resolved


def build_attachment_mission_block(refs: list[dict[str, Any]] | None) -> str:
    files = load_resolved_attachments(normalize_attachment_refs(refs))
    if not files:
        return ""
    parts: list[str] = [
        "Fichiers joints par le dirigeant dans ce tour (à prendre en compte) :",
    ]
    used = 0
    for f in files:
        block = _file_block(f)
        if used + len(block) > MAX_TOTAL_CHARS:
            parts.append(f"- {f['filename']} : extrait tronqué (limite de contexte).")
            break
        parts.append(block)
        used += len(block)
    return "\n\n".join(parts)


def _file_block(f: dict[str, Any]) -> str:
    name = str(f.get("filename") or "fichier")
    mime = str(f.get("mime") or "")
    size = int(f.get("size") or 0)
    data = f.get("data") if isinstance(f.get("data"), (bytes, bytearray)) else b""
    kind = _kind(mime, name)
    header = f"### {name}\nType : {kind} · {mime or 'inconnu'} · {size} octets"

    if kind == "image":
        return f"{header}\n{_describe_image(bytes(data), mime, name)}"
    if kind in {"text", "pdf", "office"}:
        excerpt = _extract_text(bytes(data), mime, name)
        if excerpt:
            return f"{header}\nExtrait :\n{excerpt}"
        return f"{header}\nAucun texte extractible automatiquement."
    if kind == "video":
        return (
            f"{header}\nVidéo jointe. Tu n'as pas le flux image par image ; "
            "appuie-toi sur le message du dirigeant et le nom du fichier."
        )
    if kind == "audio":
        return (
            f"{header}\nAudio joint. Tu n'as pas la transcription automatique ici ; "
            "appuie-toi sur le message du dirigeant et le nom du fichier."
        )
    return f"{header}\nFichier binaire joint (pas d'extrait texte)."


def _kind(mime: str, filename: str) -> str:
    m = (mime or "").lower()
    n = (filename or "").lower()
    ext = Path(n).suffix
    if m.startswith("image/") or ext in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return "image"
    if m.startswith("video/") or ext in {".mp4", ".webm", ".mov"}:
        return "video"
    if m.startswith("audio/") or ext in {".mp3", ".m4a", ".wav", ".ogg", ".aac"}:
        return "audio"
    if m == "application/pdf" or ext == ".pdf":
        return "pdf"
    if m.startswith("text/") or ext in {".txt", ".md", ".csv", ".json", ".html"}:
        return "text"
    if ext in {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"}:
        return "office"
    return "other"


def _extract_text(data: bytes, mime: str, filename: str) -> str:
    if not data:
        return ""
    n = (filename or "").lower()
    ext = Path(n).suffix
    try:
        if ext == ".pdf" or (mime or "").lower() == "application/pdf":
            return _pdf_text(data)
        if ext == ".docx":
            return _office_xml_text(data, "word/document.xml", "}t")
        if ext == ".pptx":
            return _pptx_text(data)
        if ext in {".txt", ".md", ".csv", ".json", ".html"} or (mime or "").lower().startswith("text/"):
            return _plain_text(data)
    except Exception:
        logger.exception("chat attachment extract %s", filename)
        return ""
    return ""


def _plain_text(data: bytes) -> str:
    text = data.decode("utf-8", errors="replace").replace("\x00", " ")
    return text.strip()[:MAX_EXCERPT_CHARS]


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    chunks: list[str] = []
    for page in reader.pages[:12]:
        t = (page.extract_text() or "").strip()
        if t:
            chunks.append(t)
        if sum(len(c) for c in chunks) >= MAX_EXCERPT_CHARS:
            break
    return "\n\n".join(chunks).strip()[:MAX_EXCERPT_CHARS]


def _office_xml_text(data: bytes, inner_path: str, tag_suffix: str) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml = zf.read(inner_path)
    root = ET.fromstring(xml)
    bits = [
        (node.text or "")
        for node in root.iter()
        if isinstance(node.tag, str) and node.tag.endswith(tag_suffix) and node.text
    ]
    return " ".join(bits).strip()[:MAX_EXCERPT_CHARS]


def _pptx_text(data: bytes) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = sorted(
            n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")
        )
        for name in names[:12]:
            root = ET.fromstring(zf.read(name))
            bits = [
                (node.text or "")
                for node in root.iter()
                if isinstance(node.tag, str) and node.tag.endswith("}t") and node.text
            ]
            if bits:
                chunks.append(" ".join(bits))
    return "\n".join(chunks).strip()[:MAX_EXCERPT_CHARS]


def _describe_image(data: bytes, mime: str, filename: str) -> str:
    if not data:
        return f"Image « {filename} » vide."
    if len(data) > MAX_VISION_BYTES:
        return (
            f"Image « {filename} » trop lourde pour l'analyse visuelle automatique "
            f"({len(data)} octets). Tiens compte du nom de fichier et du message."
        )
    key = ""
    try:
        from runtime_settings import merge_with_env

        cfg = merge_with_env()
        key = str(cfg.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY") or "").strip()
    except Exception:
        key = str(os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not key or key.startswith("sk-test"):
        return (
            f"Image « {filename} » jointe ({len(data)} octets). "
            "Analyse visuelle indisponible dans cet environnement — "
            "utilise le nom du fichier et le message du dirigeant."
        )
    media = (mime or "image/jpeg").split(";")[0].strip().lower()
    if media not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
        media = "image/jpeg"
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=key)
        b64 = base64.standard_b64encode(data).decode("ascii")
        resp = client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=700,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {"type": "base64", "media_type": media, "data": b64},
                        },
                        {
                            "type": "text",
                            "text": (
                                "Décris cette image en français : sujet, textes visibles, "
                                "ambiance, éléments utiles à un dirigeant. 8 lignes max."
                            ),
                        },
                    ],
                }
            ],
        )
        blocks = resp.content or []
        text = " ".join(
            getattr(b, "text", "") or (b.get("text", "") if isinstance(b, dict) else "")
            for b in blocks
        ).strip()
        return f"[Analyse image]\n{text}" if text else f"Image « {filename} » jointe, sans description."
    except Exception as exc:
        logger.warning("chat image vision failed: %s", exc)
        return (
            f"Image « {filename} » jointe ({len(data)} octets). "
            f"Description automatique indisponible."
        )
