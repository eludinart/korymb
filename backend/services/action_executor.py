"""Exécution réelle d'un ticket d'action — uniquement après validation dirigeant."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

# Relance CRM planifiée après un e-mail réellement envoyé (jours).
EMAIL_FOLLOW_UP_DAYS = 7


def result_is_success(text: str) -> bool:
    t = (text or "").strip()
    if t.lower().startswith("erreur") or t.lower().startswith("error"):
        return False
    return t.startswith("✅") or t.startswith("[SIMULATION]") or t.startswith("[en file]")


def execute_ticket(ticket: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
    """Exécute le ticket. Retourne (texte résultat, chaîne post-action optionnelle)."""
    kind = str(ticket.get("kind") or "").strip().lower()
    payload = ticket.get("payload") if isinstance(ticket.get("payload"), dict) else {}
    if kind == "email":
        result = _execute_email(payload)
        chain = complete_email_outcome(ticket, payload) if result_is_success(result) else None
        return result, chain
    if kind == "calendar":
        return _execute_calendar(payload), None
    if kind == "social":
        result = _execute_social(payload)
        chain = complete_social_outcome(ticket, payload) if result_is_success(result) else None
        return result, chain
    if kind == "wordpress":
        result = _execute_wordpress(payload)
        chain = complete_wordpress_outcome(ticket, payload) if result_is_success(result) else None
        return result, chain
    raise RuntimeError(f"Exécuteur non disponible pour kind={kind!r}.")


# Relance « mesurer / republier » après un post social (jours).
SOCIAL_FOLLOW_UP_DAYS = 3


def complete_social_outcome(ticket: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Après publication sociale : créneau planning pour mesurer / republier."""
    platform = str(payload.get("platform") or "réseau").strip() or "réseau"
    chain: dict[str, Any] = {
        "published": True,
        "platform": platform,
        "follow_up": None,
        "steps": [f"Post {platform} publié"],
    }
    follow = _schedule_content_follow_up(
        ticket,
        title=f"Mesurer / republier — {platform.title()}",
        days=SOCIAL_FOLLOW_UP_DAYS,
        notes=(
            f"Suite au post {platform} validé (ticket {ticket.get('id') or '—'}).\n"
            f"{str(payload.get('caption') or payload.get('message') or '')[:500]}"
        ),
    )
    if follow:
        chain["follow_up"] = follow
        when = str(follow.get("starts_at") or "")[:16].replace("T", " ")
        chain["steps"].append(f"Suivi planifié {when}" if when else "Suivi planifié")
    return chain


def complete_wordpress_outcome(ticket: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    title = str(payload.get("title") or "article").strip()
    chain: dict[str, Any] = {
        "published": True,
        "follow_up": None,
        "steps": [f"Article WordPress publié — {title[:80]}"],
    }
    follow = _schedule_content_follow_up(
        ticket,
        title=f"Relayer l'article — {title[:80]}",
        days=SOCIAL_FOLLOW_UP_DAYS,
        notes=(
            f"Suite à la publication WordPress (ticket {ticket.get('id') or '—'}).\n"
            f"Titre : {title[:200]}"
        ),
    )
    if follow:
        chain["follow_up"] = follow
        when = str(follow.get("starts_at") or "")[:16].replace("T", " ")
        chain["steps"].append(f"Relais planifié {when}" if when else "Relais planifié")
    return chain


def _schedule_content_follow_up(
    ticket: dict[str, Any],
    *,
    title: str,
    days: int,
    notes: str,
) -> dict[str, Any] | None:
    try:
        from services.business_db import create_calendar_event

        start = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(
            days=max(1, min(60, days))
        )
        end = start + timedelta(minutes=30)
        event = create_calendar_event(
            title=title[:160],
            starts_at=start.isoformat().replace("+00:00", "Z"),
            ends_at=end.isoformat().replace("+00:00", "Z"),
            event_type="autre",
            status="planned",
            notes=(notes or "")[:2000],
        )
        if not event:
            return None
        return {
            "id": event.get("id"),
            "title": event.get("title"),
            "starts_at": event.get("starts_at"),
        }
    except Exception:
        logger.warning("Content follow-up schedule failed for ticket %s", ticket.get("id"), exc_info=True)
        return None


def complete_email_outcome(ticket: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Après envoi réussi : journal CRM + créneau relance planning Korymb."""
    chain: dict[str, Any] = {
        "sent": True,
        "crm_logged": False,
        "contact_id": None,
        "contact_name": None,
        "interaction_id": None,
        "follow_up": None,
        "steps": ["E-mail envoyé"],
    }
    contact = _resolve_email_contact(payload)
    if contact:
        chain["contact_id"] = str(contact.get("id") or "") or None
        chain["contact_name"] = str(contact.get("name") or "") or None
        try:
            from services.business_db import log_interaction

            interaction = log_interaction(
                contact_id=str(contact.get("id")),
                interaction_type="email",
                summary=f"E-mail envoyé — {payload.get('subject') or ticket.get('title') or ''}"[:500],
                details=str(payload.get("body") or "")[:4000],
                agent_key=str(payload.get("agent_key") or ""),
                job_id=str(ticket.get("job_id") or ""),
            )
            chain["crm_logged"] = True
            chain["interaction_id"] = (interaction or {}).get("id")
            chain["steps"].append(
                f"Journalisé sur {chain['contact_name'] or 'la fiche contact'}"
            )
        except Exception:
            logger.warning("CRM log after email failed", exc_info=True)
            chain["steps"].append("CRM : journalisation impossible")
    else:
        chain["steps"].append("Aucun contact CRM pour ce destinataire (pas de journal)")

    follow = _schedule_email_follow_up(ticket, payload, contact)
    if follow:
        chain["follow_up"] = follow
        when = str(follow.get("starts_at") or "")[:16].replace("T", " ")
        chain["steps"].append(f"Relance planifiée {when}" if when else "Relance planifiée")
    return chain


def _resolve_email_contact(payload: dict[str, Any]) -> dict[str, Any] | None:
    try:
        from services.business_db import find_contact_by_email, get_contact

        cid = str(payload.get("contact_id") or "").strip()
        if cid:
            contact = get_contact(cid)
            if contact:
                return contact
        to = str(payload.get("to") or "").strip()
        if to:
            return find_contact_by_email(to)
    except Exception:
        logger.warning("Contact lookup after email failed", exc_info=True)
    return None


def _schedule_email_follow_up(
    ticket: dict[str, Any],
    payload: dict[str, Any],
    contact: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Créneau planning Korymb (pas Google) pour relancer le destinataire."""
    try:
        from services.business_db import create_calendar_event

        days = EMAIL_FOLLOW_UP_DAYS
        raw_days = payload.get("follow_up_days")
        if raw_days is not None:
            try:
                days = max(1, min(60, int(raw_days)))
            except (TypeError, ValueError):
                days = EMAIL_FOLLOW_UP_DAYS

        start = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=days)
        end = start + timedelta(minutes=30)
        subject = str(payload.get("subject") or ticket.get("title") or "suivi").strip()
        to = str(payload.get("to") or "").strip()
        name = str((contact or {}).get("name") or to or "contact").strip()
        title = f"Relance — {name}"[:160]
        notes = (
            f"Suite à l'e-mail « {subject[:120]} » "
            f"(ticket {ticket.get('id') or '—'}"
            f"{f', à {to}' if to else ''}).\n"
            "Créé automatiquement après validation inbox."
        )
        event = create_calendar_event(
            title=title,
            starts_at=start.isoformat().replace("+00:00", "Z"),
            ends_at=end.isoformat().replace("+00:00", "Z"),
            contact_id=str(contact.get("id")) if contact and contact.get("id") else None,
            event_type="autre",
            status="planned",
            notes=notes[:2000],
        )
        if not event:
            return None
        return {
            "id": event.get("id"),
            "title": event.get("title"),
            "starts_at": event.get("starts_at"),
            "contact_id": event.get("contact_id"),
        }
    except Exception:
        logger.warning("Follow-up schedule after email failed", exc_info=True)
        return None


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
