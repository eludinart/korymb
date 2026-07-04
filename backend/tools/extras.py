"""
tools/extras.py — Outils étendus Korymb v3.2

Insights réseaux, planification Meta, génération d'images, PDF, RSS, newsletter, traduction.
Configuration via variables d'environnement (backend/.env) — pas de provider figé dans la logique.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from integration_settings import getenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
logger = logging.getLogger(__name__)

_GRAPH_VER = "v19.0"


def _parse_publish_at(publish_at: str) -> int:
    """Convertit ISO 8601 ou timestamp Unix en secondes UTC."""
    raw = (publish_at or "").strip()
    if not raw:
        raise ValueError("Date de publication vide.")
    if raw.isdigit():
        ts = int(raw)
        if ts > 10_000_000_000:
            ts //= 1000
        return ts
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


# ═══════════════════════════════════════════════════════════════════════════════
#  INSIGHTS META — Instagram & Facebook
# ═══════════════════════════════════════════════════════════════════════════════

def run_get_instagram_insights(period: str = "week", metric: str = "") -> str:
    """Métriques Instagram Business (impressions, reach, engagement…)."""
    if not getenv("INSTAGRAM_ACCESS_TOKEN") or not getenv("INSTAGRAM_ACCOUNT_ID"):
        return "INSTAGRAM_ACCESS_TOKEN ou INSTAGRAM_ACCOUNT_ID non configuré."
    metrics = (metric or "impressions,reach,profile_views,accounts_engaged").strip()
    per = (period or "week").strip()
    try:
        resp = httpx.get(
            f"https://graph.facebook.com/{_GRAPH_VER}/{getenv("INSTAGRAM_ACCOUNT_ID")}/insights",
            params={
                "access_token": getenv("INSTAGRAM_ACCESS_TOKEN"),
                "metric": metrics,
                "period": per,
            },
            timeout=25,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        if not data:
            return f"Aucune métrique Instagram pour la période « {per} »."
        lines = [f"Insights Instagram — période {per} :"]
        for block in data:
            name = block.get("name", "?")
            title = block.get("title", name)
            values = block.get("values") or []
            if values:
                latest = values[-1]
                val = latest.get("value")
                if isinstance(val, dict):
                    val = ", ".join(f"{k}: {v}" for k, v in val.items())
                end = (latest.get("end_time") or "")[:10]
                lines.append(f"  • {title} ({name}) : {val} — fin {end}")
            else:
                lines.append(f"  • {title} ({name}) : pas de valeur")
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur insights Instagram : {e}"


def run_get_facebook_insights(period: str = "week", metric: str = "") -> str:
    """Métriques page Facebook (impressions, fans, engagement…)."""
    if not getenv("FACEBOOK_ACCESS_TOKEN") or not getenv("FACEBOOK_PAGE_ID"):
        return "FACEBOOK_ACCESS_TOKEN ou FACEBOOK_PAGE_ID non configuré."
    metrics = (metric or "page_impressions,page_post_engagements,page_fans").strip()
    per = (period or "week").strip()
    try:
        resp = httpx.get(
            f"https://graph.facebook.com/{_GRAPH_VER}/{getenv("FACEBOOK_PAGE_ID")}/insights",
            params={
                "access_token": getenv("FACEBOOK_ACCESS_TOKEN"),
                "metric": metrics,
                "period": per,
            },
            timeout=25,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        if not data:
            return f"Aucune métrique Facebook pour la période « {per} »."
        lines = [f"Insights Facebook — période {per} :"]
        for block in data:
            name = block.get("name", "?")
            title = block.get("title", name)
            values = block.get("values") or []
            if values:
                latest = values[-1]
                val = latest.get("value")
                end = (latest.get("end_time") or "")[:10]
                lines.append(f"  • {title} ({name}) : {val} — fin {end}")
            else:
                lines.append(f"  • {title} ({name}) : pas de valeur")
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur insights Facebook : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  PLANIFICATION META
# ═══════════════════════════════════════════════════════════════════════════════

def run_schedule_instagram_post(caption: str, publish_at: str, image_url: str = "") -> str:
    """Planifie un post Instagram (Meta Graph API, timestamp Unix UTC)."""
    if not getenv("INSTAGRAM_ACCESS_TOKEN") or not getenv("INSTAGRAM_ACCOUNT_ID"):
        return (
            "[SIMULATION] Post Instagram planifié :\n"
            f"Caption : {caption}\nPublication : {publish_at}\n"
            "⚠️ Configure INSTAGRAM_ACCESS_TOKEN et INSTAGRAM_ACCOUNT_ID."
        )
    try:
        ts = _parse_publish_at(publish_at)
        if ts <= int(datetime.now(timezone.utc).timestamp()) + 600:
            return "La date doit être au moins 10 minutes dans le futur (UTC)."
        payload: dict[str, Any] = {
            "caption": caption,
            "access_token": getenv("INSTAGRAM_ACCESS_TOKEN"),
        }
        if image_url:
            payload["image_url"] = image_url
            payload["media_type"] = "IMAGE"
        else:
            payload["media_type"] = "REELS"
        r1 = httpx.post(
            f"https://graph.facebook.com/{_GRAPH_VER}/{getenv("INSTAGRAM_ACCOUNT_ID")}/media",
            data=payload,
            timeout=25,
        )
        r1.raise_for_status()
        container_id = r1.json().get("id")
        r2 = httpx.post(
            f"https://graph.facebook.com/{_GRAPH_VER}/{getenv("INSTAGRAM_ACCOUNT_ID")}/media_publish",
            data={
                "creation_id": container_id,
                "access_token": getenv("INSTAGRAM_ACCESS_TOKEN"),
                "scheduled_publish_time": ts,
            },
            timeout=25,
        )
        r2.raise_for_status()
        return f"✅ Post Instagram planifié pour {publish_at} (id: {r2.json().get('id', container_id)})"
    except Exception as e:
        return f"Erreur planification Instagram : {e}"


def run_schedule_facebook_post(message: str, publish_at: str) -> str:
    """Planifie un post Facebook (published=false + scheduled_publish_time)."""
    if not getenv("FACEBOOK_ACCESS_TOKEN") or not getenv("FACEBOOK_PAGE_ID"):
        return (
            "[SIMULATION] Post Facebook planifié :\n"
            f"{message}\nPublication : {publish_at}\n"
            "⚠️ Configure FACEBOOK_ACCESS_TOKEN et FACEBOOK_PAGE_ID."
        )
    try:
        ts = _parse_publish_at(publish_at)
        if ts <= int(datetime.now(timezone.utc).timestamp()) + 600:
            return "La date doit être au moins 10 minutes dans le futur (UTC)."
        r = httpx.post(
            f"https://graph.facebook.com/{_GRAPH_VER}/{getenv("FACEBOOK_PAGE_ID")}/feed",
            data={
                "message": message,
                "published": "false",
                "scheduled_publish_time": ts,
                "access_token": getenv("FACEBOOK_ACCESS_TOKEN"),
            },
            timeout=25,
        )
        r.raise_for_status()
        return f"✅ Post Facebook planifié pour {publish_at} (id: {r.json().get('id')})"
    except Exception as e:
        return f"Erreur planification Facebook : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  GÉNÉRATION D'IMAGES — API OpenAI-compatible (configurable)
# ═══════════════════════════════════════════════════════════════════════════════

def run_generate_image(prompt: str, size: str = "1024x1024") -> str:
    """
    Génère une image à partir d'un prompt.
    Nécessite IMAGE_GEN_MODEL + IMAGE_GEN_API_KEY (ou OPENROUTER_API_KEY).
    """
    p = (prompt or "").strip()[:2000]
    if not p:
        return "Prompt vide."
    if not (getenv("IMAGE_GEN_API_KEY") or getenv("OPENROUTER_API_KEY")) or not getenv("IMAGE_GEN_MODEL"):
        return (
            "[SIMULATION] Image à générer :\n"
            f"Prompt : {p}\n"
            "⚠️ Configure IMAGE_GEN_MODEL et IMAGE_GEN_API_KEY (ou OPENROUTER_API_KEY) dans .env."
        )
    try:
        base = (getenv("IMAGE_GEN_BASE_URL") or getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
        img_key = getenv("IMAGE_GEN_API_KEY") or getenv("OPENROUTER_API_KEY")
        url = f"{base}/images/generations"
        headers = {
            "Authorization": f"Bearer {img_key}",
            "Content-Type": "application/json",
        }
        referer = getenv("OPENROUTER_HTTP_REFERER")
        title = getenv("OPENROUTER_APP_TITLE") or "Korymb"
        if referer:
            headers["HTTP-Referer"] = referer
        if title:
            headers["X-Title"] = title
        body = {
            "model": getenv("IMAGE_GEN_MODEL"),
            "prompt": p,
            "n": 1,
            "size": (size or "1024x1024").strip(),
        }
        resp = httpx.post(url, headers=headers, json=body, timeout=90)
        resp.raise_for_status()
        data = resp.json()
        items = data.get("data") or []
        if not items:
            return f"Réponse image vide : {json.dumps(data)[:400]}"
        item = items[0]
        img_url = item.get("url") or ""
        b64 = item.get("b64_json") or ""
        if img_url:
            return f"✅ Image générée ({getenv("IMAGE_GEN_MODEL")}) :\n{img_url}\n\nPrompt : {p}"
        if b64:
            return f"✅ Image générée en base64 ({getenv("IMAGE_GEN_MODEL")}, {len(b64)} caractères).\nPrompt : {p}"
        return f"Format image non reconnu : {json.dumps(item)[:300]}"
    except Exception as e:
        return f"Erreur génération image : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  PDF — extraction texte
# ═══════════════════════════════════════════════════════════════════════════════

_PDF_LIMIT = 12_000


def run_read_pdf(url: str) -> str:
    """Télécharge et extrait le texte d'un PDF public (URL http/https)."""
    u = (url or "").strip()
    if not u.lower().startswith(("http://", "https://")):
        return "URL refusée : uniquement http:// ou https://"
    try:
        resp = httpx.get(
            u,
            headers={"User-Agent": "Mozilla/5.0 (compatible; KorymbAgent/3.2)"},
            timeout=45,
            follow_redirects=True,
        )
        resp.raise_for_status()
        content_type = (resp.headers.get("content-type") or "").lower()
        if "pdf" not in content_type and not u.lower().endswith(".pdf"):
            return "L'URL ne semble pas pointer vers un PDF."
        try:
            from pypdf import PdfReader
            import io

            reader = PdfReader(io.BytesIO(resp.content))
            parts: list[str] = []
            for i, page in enumerate(reader.pages):
                text = (page.extract_text() or "").strip()
                if text:
                    parts.append(f"--- Page {i + 1} ---\n{text}")
            full = "\n\n".join(parts).strip()
            if not full:
                return "PDF lu mais aucun texte extractible (scan image ?)."
            if len(full) > _PDF_LIMIT:
                full = full[:_PDF_LIMIT] + "…"
            return f"[PDF — {len(reader.pages)} page(s)]\n{full}"
        except ImportError:
            return "Dépendance pypdf manquante — installez pypdf dans le backend."
    except Exception as e:
        return f"Erreur lecture PDF : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  RSS / VEILLE
# ═══════════════════════════════════════════════════════════════════════════════

def run_monitor_rss(feed_url: str, limit: int = 10) -> str:
    """Lit un flux RSS/Atom et retourne les derniers articles."""
    url = (feed_url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return "URL de flux invalide."
    try:
        import feedparser

        parsed = feedparser.parse(url)
        if parsed.bozo and not parsed.entries:
            return f"Flux illisible : {getattr(parsed, 'bozo_exception', 'format inconnu')}"
        title = (parsed.feed.get("title") or url).strip()
        entries = parsed.entries[: min(int(limit or 10), 25)]
        if not entries:
            return f"Flux « {title} » : aucune entrée."
        lines = [f"Flux RSS : {title} ({len(entries)} entrée(s))"]
        for e in entries:
            etitle = (e.get("title") or "(sans titre)").strip()
            link = (e.get("link") or "").strip()
            published = ""
            if e.get("published"):
                try:
                    published = parsedate_to_datetime(e["published"]).strftime("%Y-%m-%d")
                except Exception:
                    published = str(e.get("published", ""))[:10]
            summary = re.sub(r"\s+", " ", (e.get("summary") or ""))[:280]
            lines.append(f"\n• [{published}] {etitle}")
            if link:
                lines.append(f"  {link}")
            if summary:
                lines.append(f"  {summary}")
        return "\n".join(lines)
    except ImportError:
        return "Dépendance feedparser manquante."
    except Exception as e:
        return f"Erreur lecture RSS : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  NEWSLETTER — Brevo (Sendinblue)
# ═══════════════════════════════════════════════════════════════════════════════

def run_send_newsletter(
    subject: str,
    html_body: str,
    list_id: str = "",
    sender_email: str = "",
    sender_name: str = "",
) -> str:
    """Envoie une campagne email via Brevo (ex-Sendinblue)."""
    subj = (subject or "").strip()
    body = (html_body or "").strip()
    if not subj or not body:
        return "Objet et corps HTML requis."
    if not getenv("BREVO_API_KEY"):
        return (
            f"[SIMULATION] Newsletter prête :\nObjet : {subj}\n"
            f"Liste : {list_id or '(défaut)'}\n\n{body[:800]}\n\n"
            "⚠️ Configure BREVO_API_KEY dans .env pour envoyer réellement."
        )
    lid = int((list_id or getenv("BREVO_DEFAULT_LIST_ID", "0")).strip() or "0")
    if lid <= 0:
        return "list_id Brevo requis (ou BREVO_DEFAULT_LIST_ID dans .env)."
    from_addr = (sender_email or getenv("BREVO_SENDER_EMAIL", "")).strip()
    from_name = (sender_name or getenv("BREVO_SENDER_NAME", "Élude In Art")).strip()
    if not from_addr:
        return "BREVO_SENDER_EMAIL requis dans .env ou paramètre sender_email."
    try:
        payload = {
            "name": subj[:128],
            "subject": subj,
            "sender": {"name": from_name, "email": from_addr},
            "type": "classic",
            "htmlContent": body,
            "recipients": {"listIds": [lid]},
        }
        resp = httpx.post(
            "https://api.brevo.com/v3/emailCampaigns",
            headers={"api-key": getenv("BREVO_API_KEY"), "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        cid = resp.json().get("id")
        return f"✅ Campagne Brevo créée (id: {cid}) — validez l'envoi dans le tableau de bord Brevo."
    except Exception as e:
        return f"Erreur newsletter Brevo : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  TRADUCTION — DeepL
# ═══════════════════════════════════════════════════════════════════════════════

def run_translate_text(text: str, target_lang: str = "EN", source_lang: str = "") -> str:
    """Traduit un texte via DeepL API."""
    content = (text or "").strip()
    if not content:
        return "Texte vide."
    target = (target_lang or "EN").strip().upper()
    if not getenv("DEEPL_API_KEY"):
        return (
            f"[SIMULATION] Traduction vers {target} :\n{content[:1200]}\n\n"
            "⚠️ Configure DEEPL_API_KEY dans .env pour traduire réellement."
        )
    base = "https://api-free.deepl.com" if getenv("DEEPL_API_KEY").endswith(":fx") else "https://api.deepl.com"
    try:
        data: dict[str, str] = {
            "auth_key": getenv("DEEPL_API_KEY"),
            "text": content[:5000],
            "target_lang": target,
        }
        src = (source_lang or "").strip().upper()
        if src:
            data["source_lang"] = src
        resp = httpx.post(f"{base}/v2/translate", data=data, timeout=25)
        resp.raise_for_status()
        translations = resp.json().get("translations") or []
        if not translations:
            return "DeepL : réponse vide."
        out = translations[0].get("text", "")
        detected = translations[0].get("detected_source_language", "")
        prefix = f"[{detected} → {target}]" if detected else f"[→ {target}]"
        return f"{prefix}\n{out}"
    except Exception as e:
        return f"Erreur traduction DeepL : {e}"
