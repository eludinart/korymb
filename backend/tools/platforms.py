"""
tools/platforms.py — Intégrations tierces : YouTube, WhatsApp, CRM, paiements, réseaux, webhooks, TTS.
Configuration via .env — pas de provider figé dans la logique métier.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

from env_loader import load_backend_env
from integration_settings import getenv

load_backend_env()
logger = logging.getLogger(__name__)

_GRAPH_VER = "v19.0"


def _sim(name: str, detail: str) -> str:
    return f"[SIMULATION] {name} :\n{detail}\n⚠️ Configurez les clés API dans backend/.env."


# ═══════════════════════════════════════════════════════════════════════════════
#  META — commentaires (complément webhooks)
# ═══════════════════════════════════════════════════════════════════════════════

def _meta_token() -> str:
    return (
        getenv("META_PAGE_ACCESS_TOKEN", "").strip()
        or getenv("FACEBOOK_ACCESS_TOKEN", "").strip()
    )


def run_fetch_social_comments(platform: str = "facebook", limit: int = 10) -> str:
    plat = (platform or "facebook").strip().lower()
    token = _meta_token()
    page_id = getenv("FACEBOOK_PAGE_ID", "").strip()
    if not token or not page_id:
        return "META_PAGE_ACCESS_TOKEN (ou FACEBOOK_ACCESS_TOKEN) et FACEBOOK_PAGE_ID requis."
    try:
        if plat == "instagram":
            ig_id = getenv("INSTAGRAM_ACCOUNT_ID", "").strip()
            if not ig_id:
                return "INSTAGRAM_ACCOUNT_ID requis pour les commentaires IG."
            r = httpx.get(
                f"https://graph.facebook.com/{_GRAPH_VER}/{ig_id}/media",
                params={
                    "access_token": token,
                    "fields": "id,caption,comments{id,text,username,timestamp}",
                    "limit": min(int(limit or 10), 15),
                },
                timeout=25,
            )
        else:
            r = httpx.get(
                f"https://graph.facebook.com/{_GRAPH_VER}/{page_id}/feed",
                params={
                    "access_token": token,
                    "fields": "id,message,comments{id,message,from,created_time}",
                    "limit": min(int(limit or 10), 15),
                },
                timeout=25,
            )
        r.raise_for_status()
        data = r.json().get("data") or []
        lines = [f"Commentaires récents ({plat}) :"]
        for post in data:
            cap = (post.get("caption") or post.get("message") or "")[:80]
            comments = (post.get("comments") or {}).get("data") or []
            for c in comments[:5]:
                author = c.get("username") or (c.get("from") or {}).get("name", "?")
                text = (c.get("text") or c.get("message") or "")[:200]
                cid = c.get("id", "")
                lines.append(f"\n• [{author}] {text}\n  id: {cid} — post: {cap}")
        if len(lines) == 1:
            return f"Aucun commentaire récent sur {plat}."
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur fetch commentaires : {e}"


def run_reply_social_comment(platform: str, comment_id: str, message: str) -> str:
    cid = (comment_id or "").strip()
    msg = (message or "").strip()
    if not cid or not msg:
        return "comment_id et message requis."
    token = _meta_token()
    if not token:
        return _sim("Réponse commentaire", f"Plateforme : {platform}\nCommentaire : {cid}\n{msg}")
    try:
        r = httpx.post(
            f"https://graph.facebook.com/{_GRAPH_VER}/{cid}/replies",
            data={"message": msg, "access_token": token},
            timeout=20,
        )
        r.raise_for_status()
        return f"✅ Réponse publiée sur {platform} (id: {r.json().get('id', '?')})"
    except Exception as e:
        return f"Erreur réponse commentaire : {e}"


def run_list_pending_comment_replies(limit: int = 10) -> str:
    """Liste les réponses commentaires en attente d'approbation (autonomous_outputs)."""
    try:
        from database import list_autonomous_outputs

        rows = list_autonomous_outputs(status="pending", limit=min(int(limit or 10), 30))
        comments = [r for r in rows if str(r.get("output_type") or "") == "comment"]
        if not comments:
            return "Aucune réponse commentaire en attente d'approbation."
        lines = [f"Réponses commentaires en attente ({len(comments)}) :"]
        for row in comments:
            lines.append(
                f"\n• [{row.get('target_platform', '?')}] {row.get('title', '')}\n"
                f"  ref: {row.get('target_ref', '')}\n"
                f"  {str(row.get('content', ''))[:180]}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur liste réponses pending : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  YouTube
# ═══════════════════════════════════════════════════════════════════════════════

def run_search_youtube(query: str, limit: int = 8) -> str:
    key = getenv("YOUTUBE_API_KEY", "").strip()
    q = (query or "").strip()
    if not q:
        return "Requête vide."
    if not key:
        return _sim("YouTube Search", f"Requête : {q}")
    try:
        r = httpx.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "part": "snippet",
                "q": q,
                "type": "video",
                "maxResults": min(int(limit or 8), 25),
                "key": key,
            },
            timeout=20,
        )
        r.raise_for_status()
        items = r.json().get("items") or []
        if not items:
            return f"Aucune vidéo YouTube pour : {q}"
        lines = [f"YouTube — {len(items)} résultat(s) pour « {q} » :"]
        for it in items:
            sn = it.get("snippet") or {}
            vid = (it.get("id") or {}).get("videoId", "")
            lines.append(
                f"\n• {sn.get('title', '?')}\n"
                f"  https://www.youtube.com/watch?v={vid}\n"
                f"  {str(sn.get('description', ''))[:160]}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"Erreur YouTube search : {e}"


def run_get_youtube_channel_stats(channel_id: str = "") -> str:
    key = getenv("YOUTUBE_API_KEY", "").strip()
    cid = (channel_id or getenv("YOUTUBE_CHANNEL_ID", "")).strip()
    if not cid:
        return "channel_id requis (ou YOUTUBE_CHANNEL_ID dans .env)."
    if not key:
        return _sim("YouTube Stats", f"Chaîne : {cid}")
    try:
        r = httpx.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"part": "statistics,snippet", "id": cid, "key": key},
            timeout=20,
        )
        r.raise_for_status()
        items = r.json().get("items") or []
        if not items:
            return f"Chaîne introuvable : {cid}"
        ch = items[0]
        sn = ch.get("snippet") or {}
        st = ch.get("statistics") or {}
        return (
            f"Chaîne YouTube : {sn.get('title', '?')}\n"
            f"Abonnés : {st.get('subscriberCount', '?')}\n"
            f"Vues totales : {st.get('viewCount', '?')}\n"
            f"Vidéos : {st.get('videoCount', '?')}"
        )
    except Exception as e:
        return f"Erreur YouTube stats : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  WhatsApp Business
# ═══════════════════════════════════════════════════════════════════════════════

def run_send_whatsapp_message(to_phone: str, message: str) -> str:
    phone = (to_phone or "").strip().lstrip("+")
    text = (message or "").strip()
    if not phone or not text:
        return "to_phone et message requis."
    token = getenv("WHATSAPP_ACCESS_TOKEN", "").strip()
    phone_id = getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    if not token or not phone_id:
        return _sim("WhatsApp", f"À : +{phone}\n{text[:400]}")
    try:
        r = httpx.post(
            f"https://graph.facebook.com/{_GRAPH_VER}/{phone_id}/messages",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "messaging_product": "whatsapp",
                "to": phone,
                "type": "text",
                "text": {"body": text[:4096]},
            },
            timeout=25,
        )
        r.raise_for_status()
        mid = (r.json().get("messages") or [{}])[0].get("id", "?")
        return f"✅ WhatsApp envoyé à +{phone} (id: {mid})"
    except Exception as e:
        return f"Erreur WhatsApp : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  CRM — Notion ou HubSpot
# ═══════════════════════════════════════════════════════════════════════════════

def _crm_provider() -> str:
    return (getenv("CRM_PROVIDER", "") or "").strip().lower()


def run_crm_create_contact(name: str, email: str, notes: str = "", company: str = "") -> str:
    n = (name or "").strip()
    em = (email or "").strip()
    if not n:
        return "name requis."
    prov = _crm_provider()
    if prov == "notion":
        db_id = getenv("NOTION_CONTACTS_DATABASE_ID", "").strip()
        token = getenv("NOTION_API_KEY", "").strip()
        if not db_id or not token:
            return _sim("Notion CRM", f"{n} <{em}>\n{notes[:300]}")
        try:
            props: dict[str, Any] = {
                "Name": {"title": [{"text": {"content": n}}]},
            }
            if em:
                props["Email"] = {"email": em}
            if company:
                props["Company"] = {"rich_text": [{"text": {"content": company}}]}
            body: dict[str, Any] = {"parent": {"database_id": db_id}, "properties": props}
            if notes:
                body["children"] = [
                    {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"text": {"content": notes[:2000]}}]}}
                ]
            r = httpx.post(
                "https://api.notion.com/v1/pages",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=25,
            )
            r.raise_for_status()
            return f"✅ Contact Notion créé : {n} (id: {r.json().get('id', '?')})"
        except Exception as e:
            return f"Erreur Notion : {e}"
    if prov == "hubspot":
        token = getenv("HUBSPOT_API_KEY", "").strip()
        if not token:
            return _sim("HubSpot CRM", f"{n} <{em}>")
        try:
            props: dict[str, str] = {"firstname": n.split()[0] if n else n}
            if len(n.split()) > 1:
                props["lastname"] = " ".join(n.split()[1:])
            if em:
                props["email"] = em
            if company:
                props["company"] = company
            r = httpx.post(
                "https://api.hubapi.com/crm/v3/objects/contacts",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"properties": props},
                timeout=25,
            )
            r.raise_for_status()
            return f"✅ Contact HubSpot créé : {n} (id: {r.json().get('id', '?')})"
        except Exception as e:
            return f"Erreur HubSpot : {e}"
    return _sim("CRM", f"{n} <{em}>\nConfigure CRM_PROVIDER=notion|hubspot + clés associées.")


def run_crm_search_contacts(query: str, limit: int = 10) -> str:
    q = (query or "").strip()
    if not q:
        return "query requis."
    prov = _crm_provider()
    if prov == "notion":
        db_id = getenv("NOTION_CONTACTS_DATABASE_ID", "").strip()
        token = getenv("NOTION_API_KEY", "").strip()
        if not db_id or not token:
            return "NOTION_API_KEY et NOTION_CONTACTS_DATABASE_ID requis."
        try:
            r = httpx.post(
                f"https://api.notion.com/v1/databases/{db_id}/query",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json",
                },
                json={"page_size": min(int(limit or 10), 25), "filter": {"property": "Name", "title": {"contains": q}}},
                timeout=25,
            )
            r.raise_for_status()
            results = r.json().get("results") or []
            if not results:
                return f"Aucun contact Notion pour « {q} »."
            lines = [f"Contacts Notion ({len(results)}) :"]
            for page in results:
                props = page.get("properties") or {}
                title = ""
                for v in props.values():
                    if v.get("type") == "title":
                        title = (v.get("title") or [{}])[0].get("plain_text", "?")
                lines.append(f"• {title} — {page.get('id', '')[:12]}")
            return "\n".join(lines)
        except Exception as e:
            return f"Erreur recherche Notion : {e}"
    if prov == "hubspot":
        token = getenv("HUBSPOT_API_KEY", "").strip()
        if not token:
            return "HUBSPOT_API_KEY requis."
        try:
            r = httpx.post(
                "https://api.hubapi.com/crm/v3/objects/contacts/search",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"query": q, "limit": min(int(limit or 10), 25)},
                timeout=25,
            )
            r.raise_for_status()
            results = r.json().get("results") or []
            if not results:
                return f"Aucun contact HubSpot pour « {q} »."
            lines = [f"Contacts HubSpot ({len(results)}) :"]
            for c in results:
                p = c.get("properties") or {}
                lines.append(f"• {p.get('firstname', '')} {p.get('lastname', '')} — {p.get('email', '')}")
            return "\n".join(lines)
        except Exception as e:
            return f"Erreur recherche HubSpot : {e}"
    return "CRM_PROVIDER non configuré (notion | hubspot)."


# ═══════════════════════════════════════════════════════════════════════════════
#  Paiements — Stripe & PayPal
# ═══════════════════════════════════════════════════════════════════════════════

def run_get_stripe_revenue(period_days: int = 30) -> str:
    key = getenv("STRIPE_SECRET_KEY", "").strip()
    if not key:
        return _sim("Stripe", f"Revenus sur {period_days} jours")
    try:
        import time

        since = int(time.time()) - max(1, int(period_days or 30)) * 86400
        r = httpx.get(
            "https://api.stripe.com/v1/balance_transactions",
            headers={"Authorization": f"Bearer {key}"},
            params={"limit": 100, "created[gte]": since},
            timeout=25,
        )
        r.raise_for_status()
        txs = r.json().get("data") or []
        total_cents = sum(int(t.get("net") or 0) for t in txs if t.get("type") == "charge")
        currency = (txs[0].get("currency") if txs else "eur") or "eur"
        return (
            f"Stripe — {len(txs)} transaction(s) sur {period_days} jours\n"
            f"Net charges : {total_cents / 100:.2f} {currency.upper()}"
        )
    except Exception as e:
        return f"Erreur Stripe : {e}"


def run_get_paypal_balance() -> str:
    cid = getenv("PAYPAL_CLIENT_ID", "").strip()
    secret = getenv("PAYPAL_CLIENT_SECRET", "").strip()
    if not cid or not secret:
        return _sim("PayPal", "Solde du compte")
    base = getenv("PAYPAL_API_BASE", "https://api-m.paypal.com").strip().rstrip("/")
    try:
        r = httpx.post(
            f"{base}/v1/oauth2/token",
            auth=(cid, secret),
            data={"grant_type": "client_credentials"},
            timeout=20,
        )
        r.raise_for_status()
        token = r.json().get("access_token", "")
        r2 = httpx.get(
            f"{base}/v1/reporting/balances",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            timeout=20,
        )
        if r2.status_code == 200:
            bal = r2.json().get("balances") or []
            lines = ["PayPal — soldes :"]
            for b in bal:
                lines.append(f"  • {b.get('currency', '?')} : {b.get('total_balance', {}).get('value', '?')}")
            return "\n".join(lines) if len(lines) > 1 else "PayPal : aucun solde retourné."
        return f"PayPal balance API : HTTP {r2.status_code} — vérifiez les permissions du compte."
    except Exception as e:
        return f"Erreur PayPal : {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  Canva, Pinterest, Discord, Telegram, Webhook, TTS
# ═══════════════════════════════════════════════════════════════════════════════

def run_create_canva_design(template_id: str, title: str, text_fields_json: str = "{}") -> str:
    key = getenv("CANVA_API_KEY", "").strip()
    tid = (template_id or getenv("CANVA_DEFAULT_TEMPLATE_ID", "")).strip()
    t = (title or "").strip() or "Design Korymb"
    if not key or not tid:
        return _sim("Canva", f"Template {tid}\nTitre : {t}\n{text_fields_json[:200]}")
    try:
        fields = json.loads(text_fields_json or "{}")
        if not isinstance(fields, dict):
            fields = {}
        r = httpx.post(
            "https://api.canva.com/rest/v1/autofills",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"brand_template_id": tid, "title": t, "data": fields},
            timeout=60,
        )
        r.raise_for_status()
        job = r.json()
        return f"✅ Design Canva lancé : {t}\nJob : {job.get('job', {}).get('id', job)}"
    except Exception as e:
        return f"Erreur Canva : {e}"


def run_create_pinterest_pin(
    board_id: str,
    title: str,
    description: str,
    link: str = "",
    image_url: str = "",
) -> str:
    token = getenv("PINTEREST_ACCESS_TOKEN", "").strip()
    bid = (board_id or getenv("PINTEREST_BOARD_ID", "")).strip()
    if not token or not bid:
        return _sim("Pinterest", f"{title}\n{description[:200]}")
    if not image_url:
        return "image_url requis pour créer une épingle Pinterest."
    try:
        r = httpx.post(
            "https://api.pinterest.com/v5/pins",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "board_id": bid,
                "title": (title or "")[:100],
                "description": (description or "")[:500],
                "link": (link or "").strip() or None,
                "media_source": {"source_type": "image_url", "url": image_url},
            },
            timeout=30,
        )
        r.raise_for_status()
        pin = r.json()
        return f"✅ Épingle Pinterest créée : {pin.get('title', title)} (id: {pin.get('id', '?')})"
    except Exception as e:
        return f"Erreur Pinterest : {e}"


def run_send_discord_message(message: str, webhook_url: str = "") -> str:
    text = (message or "").strip()
    if not text:
        return "message requis."
    url = (webhook_url or getenv("DISCORD_WEBHOOK_URL", "")).strip()
    token = getenv("DISCORD_BOT_TOKEN", "").strip()
    channel = getenv("DISCORD_CHANNEL_ID", "").strip()
    try:
        if url:
            r = httpx.post(url, json={"content": text[:2000]}, timeout=15)
            r.raise_for_status()
            return "✅ Message Discord envoyé (webhook)."
        if token and channel:
            r = httpx.post(
                f"https://discord.com/api/v10/channels/{channel}/messages",
                headers={"Authorization": f"Bot {token}", "Content-Type": "application/json"},
                json={"content": text[:2000]},
                timeout=15,
            )
            r.raise_for_status()
            return f"✅ Message Discord envoyé (id: {r.json().get('id', '?')})"
        return _sim("Discord", text[:400])
    except Exception as e:
        return f"Erreur Discord : {e}"


def run_send_telegram_message(message: str, chat_id: str = "") -> str:
    text = (message or "").strip()
    if not text:
        return "message requis."
    token = getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat = (chat_id or getenv("TELEGRAM_CHAT_ID", "")).strip()
    if not token or not chat:
        return _sim("Telegram", text[:400])
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text[:4096]},
            timeout=15,
        )
        r.raise_for_status()
        return f"✅ Message Telegram envoyé (id: {r.json().get('result', {}).get('message_id', '?')})"
    except Exception as e:
        return f"Erreur Telegram : {e}"


def run_trigger_webhook(url: str, payload_json: str = "{}", event_name: str = "korymb_event") -> str:
    target = (url or getenv("KORYMB_WEBHOOK_URL", "") or getenv("NOTIFICATION_WEBHOOK_URL", "")).strip()
    if not target:
        return _sim("Webhook", f"Event: {event_name}\n{payload_json[:400]}")
    try:
        payload = json.loads(payload_json or "{}")
        if not isinstance(payload, dict):
            payload = {"data": payload}
    except json.JSONDecodeError:
        payload = {"raw": payload_json}
    payload.setdefault("event", event_name)
    payload.setdefault("source", "korymb")
    try:
        r = httpx.post(target, json=payload, timeout=20)
        r.raise_for_status()
        return f"✅ Webhook déclenché : {target} (HTTP {r.status_code})"
    except Exception as e:
        return f"Erreur webhook : {e}"


def run_text_to_speech(text: str, voice: str = "") -> str:
    content = (text or "").strip()
    if not content:
        return "text requis."
    provider = (getenv("TTS_PROVIDER", "") or "openai").strip().lower()
    voice_id = (voice or getenv("TTS_VOICE", "alloy")).strip()
    if provider == "elevenlabs":
        key = getenv("ELEVENLABS_API_KEY", "").strip()
        vid = getenv("ELEVENLABS_VOICE_ID", voice_id).strip()
        if not key:
            return _sim("TTS ElevenLabs", content[:300])
        try:
            r = httpx.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{vid}",
                headers={"xi-api-key": key, "Content-Type": "application/json"},
                json={"text": content[:5000], "model_id": getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2")},
                timeout=60,
            )
            r.raise_for_status()
            out = getenv("TTS_OUTPUT_DIR", "data/tts").strip()
            Path(out).mkdir(parents=True, exist_ok=True)
            fname = f"tts_{int(__import__('time').time())}.mp3"
            fpath = Path(out) / fname
            fpath.write_bytes(r.content)
            return f"✅ Audio généré (ElevenLabs) : {fpath}"
        except Exception as e:
            return f"Erreur ElevenLabs TTS : {e}"
    key = (getenv("TTS_API_KEY", "") or getenv("OPENAI_API_KEY", "")).strip()
    base = (getenv("TTS_BASE_URL", "") or "https://api.openai.com/v1").strip().rstrip("/")
    model = getenv("TTS_MODEL", "tts-1").strip()
    if not key:
        return _sim("TTS", content[:300])
    try:
        r = httpx.post(
            f"{base}/audio/speech",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": model, "voice": voice_id, "input": content[:4096]},
            timeout=60,
        )
        r.raise_for_status()
        out = getenv("TTS_OUTPUT_DIR", "data/tts").strip()
        Path(out).mkdir(parents=True, exist_ok=True)
        fname = f"tts_{int(__import__('time').time())}.mp3"
        fpath = Path(out) / fname
        fpath.write_bytes(r.content)
        return f"✅ Audio généré : {fpath}"
    except Exception as e:
        return f"Erreur TTS : {e}"
