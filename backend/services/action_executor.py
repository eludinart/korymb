"""Exécution réelle d'un ticket d'action — uniquement après validation dirigeant."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def result_is_success(text: str) -> bool:
    t = (text or "").strip()
    if t.lower().startswith("erreur") or t.lower().startswith("error"):
        return False
    return t.startswith("✅") or t.startswith("[SIMULATION]") or t.startswith("[en file]")


def execute_ticket(ticket: dict[str, Any]) -> str:
    kind = str(ticket.get("kind") or "").strip().lower()
    payload = ticket.get("payload") if isinstance(ticket.get("payload"), dict) else {}
    if kind == "email":
        result = _execute_email(payload)
        if result_is_success(result):
            _log_email_interaction(ticket, payload)
        return result
    if kind == "calendar":
        return _execute_calendar(payload)
    if kind == "social":
        return _execute_social(payload)
    if kind == "wordpress":
        return _execute_wordpress(payload)
    raise RuntimeError(f"Exécuteur non disponible pour kind={kind!r}.")


def _execute_email(payload: dict[str, Any]) -> str:
    to = str(payload.get("to") or "").strip()
    subject = str(payload.get("subject") or "").strip()
    body = str(payload.get("body") or "").strip()
    if not to or not subject:
        return "Erreur: payload e-mail incomplet (to / subject)."

    preferred = str(payload.get("tool") or "").strip()
    if preferred == "send_gmail" or _gmail_configured():
        from tools.google_api import run_send_gmail

        result = run_send_gmail(to, subject, body)
        if result_is_success(result):
            return result
        logger.warning("Gmail failed, falling back to SMTP: %s", result[:200])

    from tools import run_send_email

    return run_send_email(to, subject, body)


def _execute_calendar(payload: dict[str, Any]) -> str:
    from tools.google_api import run_create_calendar_event

    return run_create_calendar_event(
        str(payload.get("summary") or payload.get("title") or ""),
        str(payload.get("start_at") or payload.get("start") or ""),
        str(payload.get("end_at") or payload.get("end") or ""),
        str(payload.get("description") or ""),
        str(payload.get("attendees") or ""),
    )


def _execute_social(payload: dict[str, Any]) -> str:
    platform = str(payload.get("platform") or "").strip().lower()
    tool = str(payload.get("tool") or "").strip()
    caption = str(payload.get("caption") or payload.get("message") or "")
    if platform == "instagram" or "instagram" in tool:
        if tool == "schedule_instagram_post" or payload.get("publish_at"):
            from tools.extras import run_schedule_instagram_post

            return run_schedule_instagram_post(
                caption,
                str(payload.get("publish_at") or ""),
                str(payload.get("image_url") or ""),
            )
        from tools import run_post_instagram

        return run_post_instagram(caption, str(payload.get("image_url") or ""))
    if platform == "facebook" or "facebook" in tool:
        if tool == "schedule_facebook_post" or payload.get("publish_at"):
            from tools.extras import run_schedule_facebook_post

            return run_schedule_facebook_post(
                str(payload.get("message") or caption),
                str(payload.get("publish_at") or ""),
            )
        from tools import run_post_facebook

        return run_post_facebook(str(payload.get("message") or caption))
    return "Erreur: plateforme sociale inconnue (instagram | facebook)."


def _execute_wordpress(payload: dict[str, Any]) -> str:
    from tools.wordpress import run_wordpress_create_post, run_wordpress_publish

    post_id = payload.get("wp_post_id")
    if post_id:
        return run_wordpress_publish(post_id)
    return run_wordpress_create_post(
        str(payload.get("title") or ""),
        str(payload.get("content") or payload.get("html") or ""),
        str(payload.get("excerpt") or ""),
        status="publish",
    )


def _gmail_configured() -> bool:
    try:
        from tools.google_api import get_google_token

        return bool(get_google_token("gmail"))
    except Exception:
        return False


def _log_email_interaction(ticket: dict[str, Any], payload: dict[str, Any]) -> None:
    to = str(payload.get("to") or "").strip()
    if not to:
        return
    try:
        from services.business_db import find_contact_by_email, log_interaction

        contact = None
        cid = str(payload.get("contact_id") or "").strip()
        if cid:
            contact = {"id": cid}
        else:
            contact = find_contact_by_email(to)
        if not contact:
            return
        log_interaction(
            contact_id=str(contact.get("id")),
            interaction_type="email",
            summary=f"E-mail envoyé — {payload.get('subject') or ticket.get('title') or ''}"[:500],
            details=str(payload.get("body") or "")[:4000],
            agent_key=str(payload.get("agent_key") or ""),
            job_id=str(ticket.get("job_id") or ""),
        )
    except Exception:
        logger.warning("CRM log after email failed", exc_info=True)
