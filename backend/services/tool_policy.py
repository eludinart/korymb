"""Règle unique avant exécution d'un outil.

Trois effets :
- read : l'agent continue
- crm_write : écriture interne notée, la mission ne s'arrête pas
- external : ticket à valider, ou blocage si l'outil ne sait pas encore ouvrir un ticket
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

READ = "read"
CRM_WRITE = "crm_write"
EXTERNAL = "external"

QUEUEABLE_EXTERNAL = frozenset({
    "send_email",
    "send_gmail",
    "create_calendar_event",
    "post_instagram",
    "post_facebook",
    "schedule_instagram_post",
    "schedule_facebook_post",
    "wordpress_create_post",
    "post_linkedin",
})

EXTERNAL_TOOLS = QUEUEABLE_EXTERNAL | frozenset({
    "send_newsletter",
    "publish_scheduler_output",
    "reply_social_comment",
    "send_whatsapp_message",
    "crm_create_contact",
    "create_pinterest_pin",
    "send_discord_message",
    "send_telegram_message",
    "trigger_webhook",
    "gestion_request_tiime_invoice",
})

CRM_WRITE_TOOLS = frozenset({
    "gestion_upsert_contact",
    "gestion_update_contact",
    "gestion_log_interaction",
    "gestion_create_project",
    "gestion_schedule_event",
    "gestion_create_quote",
    "gestion_propose_contact_enrichment",
})


def classify_tool(name: str) -> str:
    tool = (name or "").strip()
    if tool in EXTERNAL_TOOLS:
        return EXTERNAL
    if tool in CRM_WRITE_TOOLS:
        return CRM_WRITE
    return READ


def apply_tool_policy(
    name: str,
    inp: dict[str, Any] | None = None,
    *,
    job_id: str = "",
    agent_key: str = "",
) -> str | None:
    """None = exécuter l'outil. Sinon, message à renvoyer au modèle, sans effet live."""
    effect = classify_tool(name)
    if effect == READ:
        return None
    if effect == CRM_WRITE:
        _note_crm_write(name, job_id=job_id, agent_key=agent_key)
        return None
    payload = inp if isinstance(inp, dict) else {}
    if name in QUEUEABLE_EXTERNAL:
        try:
            from services.action_queue import enqueue_from_tool

            return enqueue_from_tool(
                tool_name=name,
                inp=payload,
                job_id=job_id,
                agent_key=agent_key,
            )
        except Exception as exc:
            logger.exception("enqueue action failed for %s", name)
            return (
                f"[sandbox] Exécution bloquée pour `{name}` — file d'arbitrage indisponible ({exc}). "
                "Aucun effet externe n'a été produit."
            )
    return (
        f"[sandbox] Exécution bloquée pour `{name}` — sortie externe, validation dirigeant requise. "
        "Aucun envoi ni paiement n'a été produit."
    )


def _note_crm_write(name: str, *, job_id: str, agent_key: str) -> None:
    jid = (job_id or "").strip()
    if not jid:
        return
    line = f"[korymb] CRM noté — `{name}`" + (f" ({agent_key})" if agent_key else "") + ", mission non bloquée."
    try:
        from state import active_jobs

        job = active_jobs.get(jid)
        if isinstance(job, dict):
            logs = job.setdefault("logs", [])
            if isinstance(logs, list):
                logs.append(line)
    except Exception:
        logger.debug("CRM note skipped for %s", name, exc_info=True)
