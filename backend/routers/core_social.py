"""
routers/core_social.py — Webhooks réseaux sociaux (Meta Facebook/Instagram, LinkedIn proxy).

Endpoints :
  GET  /webhooks/meta          — vérification webhook Meta (hub.challenge)
  POST /webhooks/meta          — réception événements Facebook/Instagram
  POST /webhooks/linkedin-proxy — réception événements LinkedIn via Make/Zapier
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger(__name__)
router = APIRouter(tags=["social"])


# ── Meta Webhook ───────────────────────────────────────────────────────────────

@router.get("/webhooks/meta")
async def meta_webhook_verify(
    hub_mode: str | None = Query(default=None, alias="hub.mode"),
    hub_verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(default=None, alias="hub.challenge"),
):
    """
    Endpoint de vérification du webhook Meta (étape obligatoire lors de la configuration
    dans Meta for Developers > Webhooks).
    """
    expected_token = os.getenv("META_WEBHOOK_VERIFY_TOKEN", "").strip()
    if not expected_token:
        raise HTTPException(status_code=503, detail="META_WEBHOOK_VERIFY_TOKEN non configuré")

    if hub_mode == "subscribe" and hub_verify_token == expected_token:
        logger.info("Webhook Meta vérifié avec succès")
        return int(hub_challenge or "0")

    logger.warning("Vérification webhook Meta échouée (token incorrect ou mode invalide)")
    raise HTTPException(status_code=403, detail="Vérification webhook échouée")


@router.post("/webhooks/meta")
async def meta_webhook_receive(request: Request):
    """
    Réception des événements Meta (commentaires sur Page Facebook ou Instagram Pro).
    Chaque commentaire déclenche la génération d'une réponse LLM → autonomous_output pending.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Payload JSON invalide")

    object_type = payload.get("object", "")
    if object_type not in ("page", "instagram"):
        # Silently ACK pour les autres types d'événements Meta
        return {"status": "ignored", "object": object_type}

    try:
        from services.social import handle_meta_comment_event
        import asyncio

        entries = payload.get("entry", [])
        for entry in entries:
            for change in entry.get("changes", []):
                if change.get("field") in ("comments", "feed"):
                    event_with_meta = {**payload, "entry": [entry]}
                    asyncio.create_task(handle_meta_comment_event(event_with_meta, task_id="webhook_meta"))
    except Exception as exc:
        logger.exception("Erreur traitement webhook Meta : %s", exc)

    return {"status": "ok"}


# ── LinkedIn Proxy Webhook (via Make / Zapier) ─────────────────────────────────

@router.post("/webhooks/linkedin-proxy")
async def linkedin_proxy_receive(request: Request):
    """
    Endpoint proxy pour recevoir des événements LinkedIn transmis par Make ou Zapier.

    Format payload attendu :
      {
        "comment": "Texte du commentaire",
        "author": "Nom de l'auteur",
        "comment_id": "identifiant optionnel",
        "post_context": "Résumé du post commenté (optionnel)"
      }

    Déclenche la génération d'une réponse LLM → autonomous_output pending.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Payload JSON invalide")

    if not payload.get("comment") and not payload.get("text"):
        return {"status": "ignored", "reason": "no comment text"}

    try:
        from services.social import handle_linkedin_proxy_event
        import asyncio
        asyncio.create_task(handle_linkedin_proxy_event(payload, task_id="webhook_linkedin"))
    except Exception as exc:
        logger.exception("Erreur traitement webhook LinkedIn : %s", exc)

    return {"status": "ok"}
