"""
services/social.py — Intégrations réseaux sociaux (Meta : Facebook / Instagram).

Fonctionnalités :
  - Réception de webhooks Meta (commentaires sur Pages)
  - Génération de réponses via LLM → autonomous_outputs (pending)
  - Publication de réponses via Meta Graph API (déclenchée à l'approbation)

Variables d'environnement requises :
  META_PAGE_ACCESS_TOKEN   — token d'accès longue durée de la Page
  META_WEBHOOK_VERIFY_TOKEN — token de vérification du webhook (à configurer dans Meta for Developers)

LinkedIn : pas d'API personnelle utilisable. Canal recommandé : Make/Zapier → POST /webhooks/linkedin-proxy
"""
from __future__ import annotations

import logging
import os
import textwrap
from typing import Any

import httpx

logger = logging.getLogger(__name__)

META_GRAPH_BASE = "https://graph.facebook.com/v19.0"


# ── Helpers Meta Graph API ─────────────────────────────────────────────────────

def _meta_page_token() -> str:
    token = os.getenv("META_PAGE_ACCESS_TOKEN", "").strip()
    if not token:
        raise ValueError("META_PAGE_ACCESS_TOKEN non configuré dans .env")
    return token


async def publish_comment_reply(
    *,
    platform: str,
    target_ref: str,
    content: str,
) -> dict[str, Any]:
    """
    Publie une réponse à un commentaire via Meta Graph API.
    target_ref : identifiant du commentaire Facebook/Instagram (ex: "123456789_987654321")
    """
    token = _meta_page_token()
    url = f"{META_GRAPH_BASE}/{target_ref}/replies"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            params={"access_token": token},
            json={"message": content},
        )
    resp.raise_for_status()
    data = resp.json()
    logger.info("Réponse publiée sur %s (ref=%s) : id=%s", platform, target_ref, data.get("id"))
    return data


async def fetch_page_comments(page_id: str, limit: int = 10) -> list[dict]:
    """Récupère les derniers commentaires d'une Page (pour polling si webhook non configuré)."""
    token = _meta_page_token()
    url = f"{META_GRAPH_BASE}/{page_id}/feed"
    params = {
        "access_token": token,
        "fields": "id,message,comments{id,message,from,created_time}",
        "limit": str(limit),
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
    resp.raise_for_status()
    return resp.json().get("data", [])


# ── Génération de réponse LLM ──────────────────────────────────────────────────

def generate_comment_reply(
    *,
    platform: str,
    comment_text: str,
    post_context: str = "",
    author_name: str = "",
    task_id: str = "",
) -> str:
    """
    Génère une réponse personnalisée à un commentaire via LLM synchrone.
    Retourne le texte de la réponse.
    """
    try:
        from llm_client import llm_turn
        from services.agents import FLEUR_CONTEXT

        platform_label = "Facebook" if platform == "facebook" else "Instagram"
        author_part = f" de {author_name}" if author_name else ""
        post_part = f"\n\nContexte du post auquel il répond : {post_context[:500]}" if post_context else ""

        prompt = textwrap.dedent(f"""
            Tu es Élude In Art, praticienne de bien-être émotionnel et spirituel.
            Tu dois répondre à un commentaire{author_part} sur {platform_label}.

            {FLEUR_CONTEXT}

            Commentaire reçu :
            « {comment_text[:800]} »{post_part}

            Ta réponse doit être :
            - Chaleureuse, bienveillante, authentique — comme si c'était moi (Élude) qui répondais
            - Courte (2-4 phrases maximum), adaptée au format réseaux sociaux
            - Sans hashtags excessifs, sans formules génériques comme "Merci pour votre message"
            - Elle peut inviter à continuer la conversation ou à découvrir mes services si pertinent

            Réponds UNIQUEMENT avec le texte de la réponse, sans guillemets, sans introduction.
        """).strip()

        result, _, _ = llm_turn(
            prompt,
            max_tokens=200,
            or_profile="lite",
            usage_context=f"social_reply:{task_id or 'manual'}",
        )
        return result.strip()
    except Exception as exc:
        logger.error("Génération réponse commentaire échouée : %s", exc)
        return ""


# ── Traitement webhook entrant ─────────────────────────────────────────────────

async def handle_meta_comment_event(event: dict, task_id: str = "webhook") -> None:
    """
    Traite un événement commentaire reçu via webhook Meta.
    Génère une réponse LLM et crée un autonomous_output (pending).
    """
    import asyncio
    loop = asyncio.get_event_loop()

    try:
        # Extraction des champs selon la structure webhook Meta
        entry = event.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})

        comment_id = value.get("comment_id") or value.get("id") or ""
        comment_text = value.get("message") or value.get("text") or ""
        author_name = (value.get("from") or {}).get("name") or ""
        post_id = value.get("post_id") or entry.get("id") or ""
        platform = "instagram" if event.get("object") == "instagram" else "facebook"

        if not comment_text:
            logger.debug("Webhook Meta : événement sans texte ignoré")
            return

        logger.info("Commentaire reçu sur %s (comment_id=%s)", platform, comment_id)

        # Génération de la réponse en executor (LLM sync)
        # lambda car run_in_executor ne supporte pas les kwargs directement
        reply = await loop.run_in_executor(
            None,
            lambda: generate_comment_reply(
                platform=platform,
                comment_text=comment_text,
                author_name=author_name,
                task_id=task_id,
            ),
        )

        if not reply:
            logger.warning("Réponse LLM vide pour commentaire %s — ignoré", comment_id)
            return

        from database import create_autonomous_output
        create_autonomous_output(
            task_id=task_id,
            output_type="comment",
            target_platform=platform,
            target_ref=comment_id,
            title=f"Réponse commentaire {platform} — {author_name or comment_id[:12]}",
            content=reply,
        )
        logger.info("Output commentaire créé pour %s (pending approbation)", comment_id)

    except Exception as exc:
        logger.exception("Erreur traitement webhook commentaire : %s", exc)


# ── Webhook LinkedIn proxy (via Make/Zapier) ───────────────────────────────────

async def handle_linkedin_proxy_event(payload: dict, task_id: str = "linkedin") -> None:
    """
    Reçoit un événement LinkedIn transmis par Make/Zapier.
    Même logique que Facebook : génère une réponse → autonomous_output pending.
    """
    import asyncio
    loop = asyncio.get_event_loop()

    comment_text = payload.get("comment") or payload.get("text") or ""
    author_name = payload.get("author") or ""
    post_context = payload.get("post_context") or ""
    comment_ref = payload.get("comment_id") or payload.get("id") or ""

    if not comment_text:
        return

    reply = await loop.run_in_executor(
        None,
        lambda: generate_comment_reply(
            platform="linkedin",
            comment_text=comment_text,
            author_name=author_name,
            post_context=post_context,
            task_id=task_id,
        ),
    )

    if not reply:
        return

    from database import create_autonomous_output
    create_autonomous_output(
        task_id=task_id,
        output_type="comment",
        target_platform="linkedin",
        target_ref=comment_ref,
        title=f"Réponse LinkedIn — {author_name or comment_ref[:12]}",
        content=reply,
    )
    logger.info("Output commentaire LinkedIn créé (pending approbation)")
