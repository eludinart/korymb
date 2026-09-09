"""Notification Telegram pour tickets d'action (boutons inline)."""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from integration_settings import getenv

logger = logging.getLogger(__name__)


def _token() -> str:
    return (getenv("TELEGRAM_HITL_BOT_TOKEN") or getenv("TELEGRAM_BOT_TOKEN") or "").strip()


def _chat_id() -> str:
    return (getenv("TELEGRAM_CHAT_ID") or "").strip()


def _inbox_url(ticket_id: str) -> str:
    base = (os.getenv("KORYMB_PUBLIC_URL") or "https://korymb.eludein.art").strip().rstrip("/")
    return f"{base}/inbox?triage=1&focus={ticket_id}"


def telegram_notify_configured() -> bool:
    return bool(_token() and _chat_id())


def hitl_callbacks_enabled() -> bool:
    """Boutons callback uniquement si bot HITL dédié (évite de voler getUpdates Hermes)."""
    return bool((getenv("TELEGRAM_HITL_BOT_TOKEN") or "").strip())


def notify_action_ticket(ticket: dict[str, Any]) -> dict[str, Any]:
    if (os.getenv("ENV") or "").strip().lower() == "test":
        return {"status": "skipped"}
    if not telegram_notify_configured():
        return {"status": "skipped"}
    tid = str(ticket.get("id") or "")
    kind = str(ticket.get("kind") or "")
    title = str(ticket.get("title") or "Action à valider")
    summary = str(ticket.get("summary") or "")[:700]
    text = (
        f"⚡ Korymb — {kind}\n"
        f"{title}\n\n"
        f"{summary}\n\n"
        f"Inbox : {_inbox_url(tid)}"
    )
    if hitl_callbacks_enabled():
        keyboard = {
            "inline_keyboard": [[
                {"text": "✅ Valider", "callback_data": f"k:a:{tid}"},
                {"text": "✕ Rejeter", "callback_data": f"k:r:{tid}"},
            ]]
        }
    else:
        keyboard = {
            "inline_keyboard": [[
                {"text": "Ouvrir l'inbox", "url": _inbox_url(tid)},
            ]]
        }
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{_token()}/sendMessage",
            json={
                "chat_id": _chat_id(),
                "text": text[:4000],
                "disable_web_page_preview": True,
                "reply_markup": keyboard,
            },
            timeout=15,
        )
        r.raise_for_status()
        data = r.json() if r.content else {}
        msg_id = str((data.get("result") or {}).get("message_id") or "")
        return {"status": "sent", "telegram_msg_id": msg_id, "telegram_chat_id": _chat_id()}
    except Exception as exc:
        logger.warning("Telegram notify failed for %s: %s", tid, exc)
        return {"status": "error", "error": str(exc)}


def answer_callback(callback_id: str, text: str) -> None:
    if not _token() or not callback_id:
        return
    try:
        httpx.post(
            f"https://api.telegram.org/bot{_token()}/answerCallbackQuery",
            json={"callback_query_id": callback_id, "text": text[:200]},
            timeout=10,
        )
    except Exception:
        logger.warning("answerCallbackQuery failed")
