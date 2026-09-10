"""Outils de production studio : PDF brandé, podcast TTS, vidéo IA, LinkedIn."""
from __future__ import annotations

import io
import logging
import re
from pathlib import Path
from typing import Any

import httpx

from integration_settings import getenv
from services.resource_files import save_upload

logger = logging.getLogger(__name__)


def _sim(name: str, detail: str) -> str:
    return (
        f"[SIMULATION] {name} :\n{detail}\n"
        "⚠️ Branchez l'outil dans Administration → Intégrations pour produire le fichier réel."
    )


def _ascii_fallback(text: str) -> str:
    table = str.maketrans(
        "àâäáéèêëíìîïóòôöúùûüçñÅÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ",
        "aaaaeeeeiiiioooouuuucnAAAAEEEEIIOOUUUC",
    )
    return (text or "").translate(table)


def _render_pdf_bytes(heading: str, sub: str, content: str, *, unicode_ok: bool) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_left_margin(18)
    pdf.set_right_margin(18)
    family = "Helvetica"
    font_path = _pdf_font() if unicode_ok else None
    if font_path:
        pdf.add_font("Brand", fname=str(font_path))
        family = "Brand"
    usable = max(pdf.epw, 160)
    pdf.set_text_color(76, 29, 109)
    pdf.set_font(family, size=16)
    pdf.multi_cell(usable, 8, heading)
    pdf.set_text_color(88, 28, 135)
    if sub:
        pdf.set_font(family, size=11)
        pdf.multi_cell(usable, 6, sub)
        pdf.ln(2)
    pdf.set_draw_color(167, 139, 250)
    pdf.set_line_width(0.6)
    y = pdf.get_y()
    pdf.line(pdf.l_margin, y, pdf.l_margin + usable, y)
    pdf.ln(6)
    pdf.set_text_color(30, 41, 59)
    pdf.set_font(family, size=11)
    for para in content.split("\n\n"):
        chunk = para.strip()
        if not chunk:
            continue
        pdf.multi_cell(usable, 6, chunk)
        pdf.ln(3)
    pdf.set_y(-22)
    pdf.set_font(family, size=8)
    pdf.set_text_color(100, 116, 139)
    footer = "Élude In Art — Fleur d'ÅmÔurs" if family == "Brand" else "Elude In Art — Fleur d'Amours"
    pdf.cell(usable, 8, footer, align="C")
    buf = io.BytesIO()
    pdf.output(buf)
    return buf.getvalue()


def _pdf_font() -> Path | None:
    candidates = [
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\calibri.ttf"),
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
        Path("/usr/share/fonts/truetype/freefont/FreeSans.ttf"),
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def _plain_from_markdown(text: str) -> str:
    raw = (text or "").replace("\r\n", "\n")
    raw = re.sub(r"^#{1,6}\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\*\*(.+?)\*\*", r"\1", raw)
    raw = re.sub(r"\*(.+?)\*", r"\1", raw)
    raw = re.sub(r"`([^`]+)`", r"\1", raw)
    raw = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", raw)
    return raw.strip()


def run_create_branded_pdf(title: str, body: str, subtitle: str = "") -> str:
    """Génère un PDF UTF-8 brandé et l'enregistre comme ressource fichier."""
    heading = (title or "").strip()[:180] or "Document Élude In Art"
    sub = (subtitle or "").strip()[:240]
    content = _plain_from_markdown(body)
    if not content:
        return "Erreur: contenu vide pour le PDF."
    try:
        from fpdf import FPDF  # noqa: F401
    except ImportError:
        saved = save_upload(
            filename=f"{heading[:80]}.md",
            mime="text/markdown",
            data=f"# {heading}\n\n{sub}\n\n{body}".encode("utf-8"),
        )
        if not saved.get("success"):
            return saved.get("error") or "Impossible d'enregistrer le markdown."
        fid = saved["file"]["id"]
        return (
            f"[SIMULATION] PDF (fpdf2 absent) — markdown enregistré `{fid}`.\n"
            "Installez fpdf2 dans le backend pour un vrai PDF brandé."
        )

    try:
        data = _render_pdf_bytes(heading, sub, content, unicode_ok=True)
    except Exception:
        data = _render_pdf_bytes(
            _ascii_fallback(heading),
            _ascii_fallback(sub),
            _ascii_fallback(content),
            unicode_ok=False,
        )
    fname = re.sub(r"[^\w.\-àâäéèêëïîôùûüç ]+", "_", heading, flags=re.IGNORECASE)[:80] or "document"
    saved = save_upload(filename=f"{fname}.pdf", mime="application/pdf", data=data)
    if not saved.get("success"):
        return saved.get("error") or "Enregistrement PDF impossible."
    meta = saved["file"]
    return (
        f"✅ PDF brandé créé : {meta['filename']} ({meta['size']} octets)\n"
        f"file_id: {meta['id']}\n"
        "À publier dans l'espace via le bouton Studio → Publier, après relecture."
    )


def run_create_podcast_episode(title: str, script: str, voice: str = "") -> str:
    """TTS du script puis enregistrement MP3 en ressource fichier."""
    from tools.platforms import run_text_to_speech

    heading = (title or "").strip()[:180] or "Épisode"
    spoken = (script or "").strip()
    if len(spoken) < 40:
        return "Erreur: script trop court pour un épisode (40 caractères minimum)."
    tts = run_text_to_speech(spoken[:5000], voice)
    path_match = re.search(r"([A-Za-z]:\\[^\s]+\.mp3|/[\w./-]+\.mp3)", tts or "")
    if path_match:
        audio_path = Path(path_match.group(1))
        if audio_path.is_file():
            data = audio_path.read_bytes()
            saved = save_upload(
                filename=f"{heading[:80]}.mp3",
                mime="audio/mpeg",
                data=data,
            )
            if saved.get("success"):
                meta = saved["file"]
                return (
                    f"✅ Épisode podcast : {meta['filename']}\n"
                    f"file_id: {meta['id']}\n"
                    f"TTS : {tts[:240]}"
                )
    if tts.startswith("[SIMULATION]"):
        return tts + "\nVoix gratuite : Edge TTS. Qualité : ELEVENLABS_API_KEY ou TTS_API_KEY."
    return tts


def run_generate_video(prompt: str, duration_seconds: int = 5, aspect_ratio: str = "9:16") -> str:
    """Clip payant (Replicate / fal / Runway) ou storyboard d'images gratuit."""
    from tools.media_engines import generate_video

    return generate_video(prompt, duration_seconds, aspect_ratio)


def run_post_linkedin(text: str, image_url: str = "") -> str:
    """Publication LinkedIn UGC — appelée seulement après validation HITL."""
    body = (text or "").strip()
    if not body:
        return "Texte LinkedIn vide."
    token = getenv("LINKEDIN_ACCESS_TOKEN", "").strip()
    author = getenv("LINKEDIN_AUTHOR_URN", "").strip()
    if not token or not author:
        return _sim("LinkedIn", f"Auteur : {author or '(LINKEDIN_AUTHOR_URN manquant)'}\n\n{body[:800]}")
    payload: dict[str, Any] = {
        "author": author,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": body[:3000]},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    if image_url.strip():
        payload["specificContent"]["com.linkedin.ugc.ShareContent"]["shareMediaCategory"] = "ARTICLE"
        payload["specificContent"]["com.linkedin.ugc.ShareContent"]["media"] = [
            {"status": "READY", "originalUrl": image_url.strip()}
        ]
    try:
        r = httpx.post(
            "https://api.linkedin.com/v2/ugcPosts",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
            },
            json=payload,
            timeout=25,
        )
        r.raise_for_status()
        pid = r.headers.get("x-restli-id") or r.json().get("id")
        return f"✅ Post LinkedIn publié ({pid})"
    except Exception as e:
        return f"Erreur LinkedIn : {e}"
