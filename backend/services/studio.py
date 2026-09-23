"""Studio de contenus Korymb — briefs, catalogue, lancement, publication.

Le studio n'est pas un second moteur IA : il assemble un brief de production
(marque + mémoire + format) puis lance une mission Community Manager, avec
HITL pour toute publication externe.
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import BackgroundTasks
from integration_settings import getenv
from tenant_context import get_workspace_id

logger = logging.getLogger(__name__)

STUDIO_DISMISS_CONFIRM = "SUPPRIMER"
_STALE_DAYS = 2
_STALE_CHECK_AT = 0.0
_STALE_CHECK_TTL_S = 600.0

STUDIO_FORMATS: tuple[dict[str, Any], ...] = (
    {
        "id": "article",
        "label": "Article de blog",
        "group": "éditorial",
        "icon": "✍️",
        "description": "Article long format SEO, chapô, H2, CTA, prêt pour WordPress.",
        "resource_type": "document",
        "channels": ("wordpress",),
        "tools": ("wordpress_create_post", "generate_image", "create_branded_pdf"),
        "duration_hint": "8–12 min de lecture",
        "brief": (
            "Rédige un article complet (1 000–1 600 mots), posture non divinatoire. "
            "Structure : titre accrocheur sans clickbait, chapô 2–3 phrases, 4–6 H2, "
            "exemples concrets liés à l'offre, CTA unique. HTML propre pour WordPress. "
            "Puis wordpress_create_post (brouillon HITL)."
        ),
    },
    {
        "id": "social_instagram",
        "label": "Post Instagram",
        "group": "réseaux",
        "icon": "📸",
        "description": "Caption + visuel 4:5, hashtags de niche, invitation plutôt que vente.",
        "resource_type": "",
        "channels": ("instagram",),
        "tools": ("generate_image", "post_instagram", "create_canva_design"),
        "duration_hint": "feed 4:5 · 150–300 mots",
        "brief": (
            "Produis un post Instagram : accroche 1 ligne, corps invitant, 3–5 hashtags de niche "
            "(pas de #love #tarot génériques), CTA doux. Génère un visuel 1080×1350 via generate_image "
            "(esthétique végétale, cartes, lumière douce — pas de cliché voyance). "
            "Puis post_instagram (file HITL)."
        ),
    },
    {
        "id": "social_facebook",
        "label": "Post Facebook",
        "group": "réseaux",
        "icon": "👤",
        "description": "Texte plus long, conversationnel, relais de l'article ou de la séance.",
        "resource_type": "",
        "channels": ("facebook",),
        "tools": ("post_facebook", "generate_image"),
        "duration_hint": "200–400 mots",
        "brief": (
            "Rédige un post Facebook plus développé qu'Instagram, ton conversationnel, "
            "une question ouverte en fin de texte. post_facebook (HITL)."
        ),
    },
    {
        "id": "social_linkedin",
        "label": "Post LinkedIn",
        "group": "réseaux",
        "icon": "💼",
        "description": "Texte plus développé, pour des pairs ou des clients.",
        "resource_type": "",
        "channels": ("linkedin",),
        "tools": ("post_linkedin",),
        "duration_hint": "130–220 mots",
        "brief": (
            "Rédige un post LinkedIn pour des professionnels de l'accompagnement : "
            "une observation de terrain, un cadre métier clair, un enseignement, un CTA sobre. "
            "Pas de jargon marketing. post_linkedin (HITL)."
        ),
    },
    {
        "id": "social_pinterest",
        "label": "Épingle Pinterest",
        "group": "réseaux",
        "icon": "📌",
        "description": "Pin vertical 2:3, titre SEO, description longue, lien site.",
        "resource_type": "",
        "channels": ("pinterest",),
        "tools": ("generate_image", "create_pinterest_pin"),
        "duration_hint": "pin 1000×1500",
        "brief": (
            "Conçois une épingle Pinterest : titre SEO 40–60 caractères, description 300–500 signes, "
            "visuel vertical 2:3 (generate_image). create_pinterest_pin (HITL)."
        ),
    },
    {
        "id": "carousel",
        "label": "Carrousel Instagram",
        "group": "réseaux",
        "icon": "🎠",
        "description": "5 à 8 slides pédagogiques, une idée par carte, CTA sur la dernière.",
        "resource_type": "",
        "channels": ("instagram",),
        "tools": ("generate_image", "post_instagram", "create_canva_design"),
        "duration_hint": "5–8 slides",
        "brief": (
            "Écris un carrousel 5–8 slides : slide 1 = promesse, slides milieu = une idée chacune, "
            "dernière = CTA. Pour chaque slide : texte court (max 25 mots) + prompt visuel cohérent. "
            "Génère au moins la couverture via generate_image. Caption globale + post_instagram HITL."
        ),
    },
    {
        "id": "newsletter",
        "label": "Newsletter",
        "group": "éditorial",
        "icon": "📬",
        "description": "Lettre aux inscrits (Brevo) : une histoire, une ressource, un rendez-vous.",
        "resource_type": "document",
        "channels": ("brevo",),
        "tools": ("send_newsletter", "create_branded_pdf"),
        "duration_hint": "400–700 mots",
        "brief": (
            "Rédige une newsletter HTML : objet < 45 caractères, preview text, 3 blocs "
            "(récit / ressource / prochaine date). send_newsletter passe en file HITL."
        ),
    },
    {
        "id": "podcast",
        "label": "Épisode podcast",
        "group": "audio",
        "icon": "🎙️",
        "description": "Script parlé + show notes + voix TTS, déposable dans l'espace participant.",
        "resource_type": "podcast",
        "channels": ("tts",),
        "tools": ("text_to_speech", "create_podcast_episode"),
        "duration_hint": "6–12 min parlées",
        "brief": (
            "Écris un script podcast à VOIX HAUTE (phrases courtes, respirations notées [pause]). "
            "Intro 20 s, 2–3 mouvements, outro + CTA. Show notes (titres, liens, citation). "
            "Puis create_podcast_episode avec le script intégral (TTS)."
        ),
    },
    {
        "id": "document_pdf",
        "label": "Document PDF",
        "group": "documents",
        "icon": "📄",
        "description": "Fiche, module, guide brandé (charte vitrine) pour l'espace participant.",
        "resource_type": "document",
        "channels": ("pdf",),
        "tools": ("create_branded_pdf", "create_canva_design"),
        "duration_hint": "2–8 pages",
        "brief": (
            "Rédige un document pédagogique structuré (titre, sous-titre, sections courtes, encadrés). "
            "Puis create_branded_pdf avec le contenu intégral. Marque aussi #### LIVRABLE — <titre>."
        ),
    },
    {
        "id": "video_short",
        "label": "Vidéo courte",
        "group": "vidéo",
        "icon": "🎬",
        "description": "Reel / Short 15–45 s : script, découpage, visuel, génération si API branchée.",
        "resource_type": "video",
        "channels": ("youtube", "instagram", "video_gen"),
        "tools": ("generate_video", "generate_image", "text_to_speech"),
        "duration_hint": "15–45 s · 9:16",
        "brief": (
            "Écris un script vidéo verticale 15–45 s : hook 2 s, 3 plans, CTA. "
            "Pour chaque plan : texte à l'écran + indication visuelle. "
            "Si generate_video est disponible, lance-le avec le prompt visuel global. "
            "Sinon livre le storyboard prêt à tourner + generate_image pour la miniature."
        ),
    },
    {
        "id": "youtube",
        "label": "YouTube (fiche + visuel)",
        "group": "vidéo",
        "icon": "▶️",
        "description": "Titre, description chapitrée, tags, miniature — complément d'une vidéo ou d'un podcast.",
        "resource_type": "video",
        "channels": ("youtube",),
        "tools": ("generate_image", "generate_video", "search_youtube"),
        "duration_hint": "pack publication",
        "brief": (
            "Prépare un pack YouTube : titre < 70 car., description chapitrée, 8–12 tags, "
            "accroche 2 premières lignes, prompt miniature. Vérifie qu'aucun titre concurrent "
            "évident n'existe via search_youtube si pertinent."
        ),
    },
)

FORMAT_BY_ID = {str(item["id"]): item for item in STUDIO_FORMATS}

TONES: tuple[dict[str, str], ...] = (
    {"id": "invite", "label": "Invitation", "hint": "Ouvre un espace, ne force pas."},
    {"id": "pedagogie", "label": "Pédagogie", "hint": "Clair, structuré, examples."},
    {"id": "intime", "label": "Personnel", "hint": "Voix à la première personne, vécu."},
    {"id": "pro", "label": "Professionnel", "hint": "Clair, pour des pairs ou des clients."},
    {"id": "saisonnier", "label": "Au fil de l'année", "hint": "Ancré dans une date, une saison, une rentrée."},
)

AUDIENCES: tuple[dict[str, str], ...] = (
    {"id": "clients", "label": "Clients"},
    {"id": "prospects", "label": "Prospects"},
    {"id": "equipe", "label": "Équipe"},
    {"id": "partenaires", "label": "Partenaires"},
    {"id": "grand_public", "label": "Grand public"},
)

# Identifiants historiques : encore résolus dans un brief déjà lancé, absents du catalogue.
_LEGACY_AUDIENCES: tuple[dict[str, str], ...] = (
    {"id": "coachs", "label": "Coachs & facilitateurs"},
    {"id": "therapeutes", "label": "Thérapeutes"},
    {"id": "couples", "label": "Couples & proches"},
    {"id": "participants", "label": "Inscrits"},
    {"id": "modules_pro", "label": "Parcours"},
)

DESTINATIONS: tuple[dict[str, str], ...] = (
    {
        "id": "mission",
        "label": "Brouillon mission",
        "hint": "Livrables dans votre espace Korymb. Rien n'est publié.",
    },
    {
        "id": "resource",
        "label": "Espace participant",
        "hint": "Fichier en ressource planning. Vous validez la mise en ligne ici, une fois la mission terminée.",
    },
    {
        "id": "wordpress",
        "label": "WordPress",
        "hint": "Article WordPress : un clic dans le Studio publie le brouillon si WordPress est branché.",
    },
    {
        "id": "social",
        "label": "Réseaux",
        "hint": "Instagram, Facebook, LinkedIn, Pinterest : un clic envoie le post si le connecteur est branché.",
    },
    {
        "id": "newsletter",
        "label": "Newsletter Brevo",
        "hint": "Campagne Brevo : un clic dans le Studio lance l’envoi si la clé est branchée.",
    },
)

VISIBILITIES: tuple[dict[str, str], ...] = (
    {"id": "internal", "label": "Interne — brouillon équipe"},
    {"id": "participants", "label": "Inscrits de l'espace"},
    {"id": "public", "label": "Public (vitrine)"},
)


def _env_set(*keys: str) -> bool:
    return any(bool(getenv(k, "").strip()) for k in keys)


def _media_catalog() -> dict[str, Any]:
    try:
        from tools.media_engines import catalog_status

        return catalog_status()
    except Exception:
        return {"mode": "economy", "modes": [], "engines": {}, "ready": {}}


def _setup_url(group_id: str, field: str | None = None) -> str:
    """Deep-link vers le module Intégrations (groupe ouvert + champ ciblé)."""
    path = f"/administration/integrations?group={group_id}"
    if field:
        path += f"&field={field}"
    return path


def tool_connections(media: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """État des outils de production — pour le panneau studio et le catalogue."""
    snapshot = media if media is not None else _media_catalog()
    ready_map = snapshot.get("ready") if isinstance(snapshot.get("ready"), dict) else {}
    notes: dict[str, str] = {}
    engines = snapshot.get("engines") if isinstance(snapshot.get("engines"), dict) else {}
    for kind in ("image", "tts", "video"):
        rows = engines.get(kind) or []
        names = [str(r.get("id")) for r in rows if r.get("ready")]
        notes[kind] = ("Prêt : " + " → ".join(names)) if names else ""
    items = [
        {
            "id": "memory",
            "label": "Mémoire entreprise",
            "role": "Voix de marque, offres, interdits",
            "configured": True,
            "required_for": ["tous"],
            "setup": "/administration/memory",
        },
        {
            "id": "image",
            "label": "Images (Mistral Flux)",
            "role": "Visuels feed — la clé Mistral du chat suffit, Pollinations en repli",
            "configured": bool(ready_map.get("image")),
            "required_for": ["social_instagram", "carousel", "video_short"],
            "setup": "/admin/korymb-llm",
            "docs": "MISTRAL_API_KEY — pas de clé image dédiée",
            "note": notes.get("image") or "",
        },
        {
            "id": "tts",
            "label": "Voix (gratuit + payant)",
            "role": "Podcasts, voix-off — Edge TTS puis ElevenLabs / OpenAI",
            "configured": bool(ready_map.get("tts")),
            "required_for": ["podcast", "video_short"],
            "setup": _setup_url("tts", "TTS_ENGINE_CHAIN"),
            "docs": "Chaîne TTS_ENGINE_CHAIN — Edge TTS sans clé, ElevenLabs pour une voix de marque",
            "note": notes.get("tts") or "",
        },
        {
            "id": "wordpress",
            "label": "WordPress",
            "role": "Articles WordPress",
            "configured": _env_set("WP_BASE_URL") and _env_set("WP_APP_PASSWORD"),
            "required_for": ["article"],
            "setup": _setup_url("wordpress", "WP_BASE_URL"),
        },
        {
            "id": "meta",
            "label": "Instagram & Facebook",
            "role": "Publication après validation",
            "configured": (_env_set("INSTAGRAM_ACCESS_TOKEN") and _env_set("INSTAGRAM_ACCOUNT_ID"))
            or (_env_set("FACEBOOK_ACCESS_TOKEN") and _env_set("FACEBOOK_PAGE_ID")),
            "required_for": ["social_instagram", "social_facebook", "carousel"],
            "setup": _setup_url("meta_social", "INSTAGRAM_ACCESS_TOKEN"),
        },
        {
            "id": "linkedin",
            "label": "LinkedIn",
            "role": "Posts thought-leadership HITL",
            "configured": _env_set("LINKEDIN_ACCESS_TOKEN"),
            "required_for": ["social_linkedin"],
            "setup": _setup_url("linkedin_publish", "LINKEDIN_ACCESS_TOKEN"),
            "docs": "LINKEDIN_ACCESS_TOKEN + LINKEDIN_AUTHOR_URN",
        },
        {
            "id": "pinterest",
            "label": "Pinterest",
            "role": "Épingles 2:3",
            "configured": _env_set("PINTEREST_ACCESS_TOKEN"),
            "required_for": ["social_pinterest"],
            "setup": _setup_url("visual_social", "PINTEREST_ACCESS_TOKEN"),
        },
        {
            "id": "canva",
            "label": "Canva Brand Templates",
            "role": "Mise en page à partir de tes templates",
            "configured": _env_set("CANVA_API_KEY"),
            "required_for": ["carousel"],
            "setup": _setup_url("visual_social", "CANVA_API_KEY"),
        },
        {
            "id": "video_gen",
            "label": "Vidéo IA (storyboard Mistral)",
            "role": "Plans en images via Mistral ; clip MP4 si Replicate / fal / Runway",
            "configured": bool(ready_map.get("video")),
            "required_for": ["video_short"],
            "setup": "/admin/korymb-llm",
            "docs": "Storyboard avec la clé Mistral. Clip animé : une clé Replicate en option.",
            "note": notes.get("video") or "",
        },
        {
            "id": "youtube",
            "label": "YouTube Data API",
            "role": "Recherche titres, stats chaîne",
            "configured": _env_set("YOUTUBE_API_KEY"),
            "required_for": ["youtube"],
            "setup": _setup_url("youtube", "YOUTUBE_API_KEY"),
        },
        {
            "id": "brevo",
            "label": "Brevo newsletter",
            "role": "Campagnes e-mail",
            "configured": _env_set("BREVO_API_KEY"),
            "required_for": ["newsletter"],
            "setup": _setup_url("newsletter", "BREVO_API_KEY"),
        },
    ]
    return items


def _brand_kit() -> dict[str, Any]:
    from database import get_enterprise_memory
    from tenant_context import get_workspace_id as _wid
    from workspace_db import get_workspace_by_id, public_workspace_payload

    memory = get_enterprise_memory()
    contexts = memory.get("contexts") if isinstance(memory.get("contexts"), dict) else {}
    facts: dict[str, Any] = {}
    try:
        from services.memory_inbox import get_enterprise_facts

        facts = get_enterprise_facts()
    except Exception:
        facts = {}
    storefront: dict[str, Any] = {}
    wid = (_wid() or "").strip()
    if wid:
        ws = get_workspace_by_id(wid)
        if ws:
            storefront = public_workspace_payload(ws)
    return {
        "name": str(facts.get("brand") or storefront.get("name") or "Korymb"),
        "slug": str(storefront.get("slug") or ""),
        "tagline": str(facts.get("tagline") or storefront.get("tagline") or ""),
        "intro": str(facts.get("intro") or storefront.get("intro") or "")[:800],
        "accent": str(storefront.get("accent") or ""),
        "paper": str(storefront.get("paper") or ""),
        "typeface": str(storefront.get("typeface") or ""),
        "has_logo": bool(storefront.get("has_logo")),
        "location": str(facts.get("location") or storefront.get("location") or ""),
        "offers": facts.get("offers") if isinstance(facts.get("offers"), list) else storefront.get("offers") or [],
        "memory_global": str(contexts.get("global") or "").strip(),
        "memory_community": str(contexts.get("community_manager") or "").strip(),
        "enterprise_facts": facts,
        "memory_updated_at": str(memory.get("updated_at") or ""),
    }


def catalog() -> dict[str, Any]:
    brand = _brand_kit()
    media = _media_catalog()
    connections = tool_connections(media)
    ready = {c["id"]: bool(c.get("configured")) for c in connections}
    formats = []
    for item in STUDIO_FORMATS:
        needed = [c["id"] for c in connections if item["id"] in (c.get("required_for") or [])]
        missing = [cid for cid in needed if cid not in {"memory"} and not ready.get(cid)]
        formats.append({**item, "missing_connections": missing, "ready": not missing})
    return {
        "formats": formats,
        "tones": list(TONES),
        "audiences": list(AUDIENCES),
        "destinations": list(DESTINATIONS),
        "visibilities": list(VISIBILITIES),
        "connections": connections,
        "brand": {
            "name": brand["name"],
            "tagline": brand["tagline"],
            "has_logo": brand["has_logo"],
            "has_global_memory": bool(brand["memory_global"]),
            "has_community_memory": bool(brand["memory_community"]),
            "accent": brand["accent"],
        },
        "ethics": [
            "Respecter la charte et la mémoire du workspace.",
            "Inviter plutôt que vendre. Un seul CTA par pièce.",
            "Propositions exécutables avec les ressources réellement disponibles.",
            "Vous validez la publication dans le Studio. Dans Korymb, ça devient une ressource. Sur un réseau, le connecteur envoie le post.",
        ],
        "media": media,
    }


def build_production_brief(
    *,
    prompt: str,
    formats: list[str],
    tone: str = "invite",
    audience: str = "clients",
    cta: str = "",
    destination: str = "mission",
    visibility: str = "internal",
    extra: str = "",
    media_engine_mode: str = "",
) -> str:
    brand = _brand_kit()
    tone_row = next((t for t in TONES if t["id"] == tone), TONES[0])
    audience_row = next((a for a in (*AUDIENCES, *_LEGACY_AUDIENCES) if a["id"] == audience), AUDIENCES[0])
    dest_row = next((d for d in DESTINATIONS if d["id"] == destination), DESTINATIONS[0])
    selected = [FORMAT_BY_ID[fid] for fid in formats if fid in FORMAT_BY_ID]
    if not selected:
        selected = [FORMAT_BY_ID["article"]]

    lines = [
        "# Brief de production — Studio Korymb",
        "",
        f"Tu es le Community Manager / rédacteur en chef de « {brand.get('name') or 'Korymb'} ». "
        "Tu produis des pièces **prêtes à l'emploi**, pas des intentions. "
        "Chaque format demandé a un bloc `#### LIVRABLE — <titre>` avec le contenu intégral.",
        "",
        "## Intention du dirigeant",
        prompt.strip(),
        "",
        f"**Ton :** {tone_row['label']} — {tone_row['hint']}",
        f"**Audience :** {audience_row['label']}",
        f"**Destination :** {dest_row['label']} — {dest_row['hint']}",
    ]
    if cta.strip():
        lines.append(f"**CTA demandé :** {cta.strip()}")
    if destination == "resource":
        lines.append(
            f"**Visibilité cible (après validation studio) :** {visibility}. "
            "Génère le fichier (PDF / MP3 / MP4) via les outils studio ; "
            "ne crée pas toi-même l'événement public."
        )
    lines += [
        "",
        "## Identité de marque (vitrine + mémoire)",
        f"- Nom : {brand['name']}",
        f"- Accroche : {brand['tagline'] or '(a formuler, ne pas inventer d une offre)'}",
        f"- Lieu : {brand['location'] or 'Tourves / Haut-Var'}",
    ]
    offers = brand.get("offers") if isinstance(brand.get("offers"), list) else []
    offer_titles = [
        str(o.get("title") if isinstance(o, dict) else o).strip()
        for o in offers
        if (isinstance(o, dict) and o.get("title")) or (not isinstance(o, dict) and str(o).strip())
    ]
    if offer_titles:
        lines.append(f"- Offres : {', '.join(offer_titles[:8])}")
    facts = brand.get("enterprise_facts") if isinstance(brand.get("enterprise_facts"), dict) else {}
    if facts.get("tone"):
        lines.append(f"- Ton : {facts.get('tone')}")
    if brand["memory_global"]:
        lines += ["", "### Mémoire globale", brand["memory_global"][:2000]]
    if brand["memory_community"]:
        lines += ["", "### Périmètre community", brand["memory_community"][:1600]]
    lines += [
        "",
        "## Formats à produire",
    ]
    for fmt in selected:
        lines.append(f"### {fmt['label']} (`{fmt['id']}`)")
        lines.append(fmt["brief"])
        lines.append(f"Outils attendus : {', '.join(fmt['tools'])}.")
        lines.append("")
    lines += [
        "## Contraintes de production",
        "- Français soigné, tutoiement ou vouvoiement cohérent avec la mémoire (par défaut : vouvoiement public, tutoiement intime si demandé).",
        "- Aucune divination, horoscope, « tirez une carte pour connaître votre avenir ».",
        "- Ne pas inventer de dates de stage, tarifs ou URLs absents de la mémoire / du brief.",
        "- Publications externes : prépare le post (et le ticket HITL si l'outil le fait). "
        "Le dirigeant valide ensuite dans le Studio : si le connecteur est branché, l'envoi part.",
        "- Si un outil n'est pas configuré, livre quand même le texte / storyboard et signale le manque.",
        "- Un visuel : prompt détaillé (lumière, cadrage, interdits : boule de cristal, clichés new-age).",
        "- Moteurs média : une chaîne gratuit → payant. N'invente pas de provider. "
        "Appelle generate_image / text_to_speech / generate_video ; le runtime choisit le moteur.",
    ]
    if extra.strip():
        lines += ["", "## Consignes supplémentaires", extra.strip()]
    token = None
    try:
        from tools.media_engines import catalog_status, normalize_mode, push_media_engine_mode, reset_media_engine_mode

        mode = normalize_mode(media_engine_mode)
        token = push_media_engine_mode(mode)
        media = catalog_status()
        label = "Économique" if mode == "economy" else "Qualité publication"
        lines += [
            "",
            "## Moteurs de production",
            f"Mode **{label}**. Les outils media suivent la chaîne configurée (Intégrations).",
        ]
        engines = media.get("engines") if isinstance(media.get("engines"), dict) else {}
        for kind, title in (("image", "Image"), ("tts", "Audio"), ("video", "Vidéo")):
            rows = engines.get(kind) or []
            names = [str(r.get("id")) for r in rows]
            if names:
                lines.append(f"- {title} : " + " → ".join(names))
        lines.append("PDF : moteur local (gratuit), Canva optionnel.")
    except Exception:
        pass
    finally:
        if token is not None:
            from tools.media_engines import reset_media_engine_mode

            reset_media_engine_mode(token)
    return "\n".join(lines)


def launch_generation(
    background_tasks: BackgroundTasks,
    *,
    prompt: str,
    formats: list[str],
    tone: str = "invite",
    audience: str = "clients",
    cta: str = "",
    destination: str = "mission",
    visibility: str = "internal",
    extra: str = "",
    project_id: str = "",
    require_user_validation: bool = True,
    media_engine_mode: str = "",
) -> dict[str, Any]:
    from services.mission import _mission_config_from_payload, _schedule_mission_execution

    clean_formats = [f for f in formats if f in FORMAT_BY_ID]
    if not clean_formats:
        raise ValueError("Choisissez au moins un format de contenu.")
    text = (prompt or "").strip()
    if len(text) < 8:
        raise ValueError("Décrivez le sujet en quelques phrases (minimum 8 caractères).")
    if destination not in {d["id"] for d in DESTINATIONS}:
        destination = "mission"
    if visibility not in {v["id"] for v in VISIBILITIES}:
        visibility = "internal"
    if tone not in {t["id"] for t in TONES}:
        tone = "invite"
    known_audiences = {a["id"] for a in (*AUDIENCES, *_LEGACY_AUDIENCES)}
    if audience not in known_audiences:
        audience = "clients"
    try:
        from tools.media_engines import normalize_mode

        media_engine_mode = normalize_mode(media_engine_mode)
    except Exception:
        media_engine_mode = "economy"

    mission = build_production_brief(
        prompt=text,
        formats=clean_formats,
        tone=tone,
        audience=audience,
        cta=cta,
        destination=destination,
        visibility=visibility,
        extra=extra,
        media_engine_mode=media_engine_mode,
    )
    job_id = uuid.uuid4().hex[:12]
    multi = len(clean_formats) > 2
    cfg = _mission_config_from_payload(
        {
            "mode": "cio" if multi else "single",
            "require_user_validation": require_user_validation,
            "cio_plan_hitl_enabled": multi,
        }
    )
    agent_key = "coordinateur" if len(clean_formats) > 2 else "community_manager"
    context = {
        "studio": {
            "formats": clean_formats,
            "tone": tone,
            "audience": audience,
            "destination": destination,
            "visibility": visibility,
            "project_id": (project_id or "").strip()[:64],
            "cta": (cta or "").strip()[:400],
            "media_engine_mode": media_engine_mode,
        }
    }
    _schedule_mission_execution(
        background_tasks,
        job_id,
        agent_key,
        mission,
        context,
        f"studio:{','.join(clean_formats)}",
        mission_config=cfg,
    )
    logger.info("Studio generate job=%s formats=%s dest=%s", job_id, clean_formats, destination)
    return {
        "status": "accepted",
        "job_id": job_id,
        "agent": agent_key,
        "formats": clean_formats,
        "destination": destination,
        "visibility": visibility,
        "next": {
            "mission": f"/missions?job={job_id}",
            "inbox": "/inbox",
            "hint": (
                "La production tourne en mission. Quand elle est terminée, revenez ici : "
                "Valider et publier dans l’espace, ou sur le réseau si le connecteur est branché."
            ),
        },
    }


def _studio_queue(job: dict[str, Any]) -> dict[str, Any]:
    ui = job.get("deliverables_ui") if isinstance(job.get("deliverables_ui"), dict) else {}
    studio = ui.get("studio") if isinstance(ui.get("studio"), dict) else {}
    return studio


def _piece_queue_state(job: dict[str, Any], format_id: str) -> str:
    studio = _studio_queue(job)
    if studio.get("dismissed_job") is True:
        return "dismissed"
    pieces = studio.get("pieces") if isinstance(studio.get("pieces"), dict) else {}
    row = pieces.get(format_id) if isinstance(pieces.get(format_id), dict) else {}
    state = str((row or {}).get("state") or "").strip().lower()
    return state if state in ("published", "dismissed", "pending") else "pending"


def _mark_studio_piece(job_id: str, format_id: str, state: str, *, target: str = "") -> None:
    from database import merge_job_studio_queue

    merge_job_studio_queue(
        job_id,
        {
            "piece": {
                "format_id": format_id,
                "state": state,
                "at": datetime.now(timezone.utc).isoformat(),
                "target": target,
            }
        },
    )


def list_studio_runs(*, limit: int = 20) -> list[dict[str, Any]]:
    from database import list_jobs

    _maybe_notify_stale_studio_pieces()
    out: list[dict[str, Any]] = []
    for job in list_jobs(limit=max(limit * 6, 80)):
        source = str(job.get("source") or "")
        if not source.startswith("studio:"):
            continue
        run = _serialize_studio_run(job)
        if run is None:
            continue
        out.append(run)
        if len(out) >= limit:
            break
    return out


def _serialize_studio_run(job: dict[str, Any]) -> dict[str, Any] | None:
    source = str(job.get("source") or "")
    formats = [p for p in source.split(":", 1)[-1].split(",") if p]
    status = str(job.get("status") or "")
    studio = _studio_queue(job)
    if studio.get("dismissed_job") is True:
        return None
    pieces = [dict(p) for p in describe_studio_pieces(job)]
    for p in pieces:
        body = str(p.get("body") or "")[:80_000]
        p["body"] = body
        p["body_preview"] = body[:400]
    visible = [p for p in pieces if str(p.get("queue_state") or "pending") == "pending"]
    ready_status = status in ("completed", "done")
    if ready_status and pieces and not visible:
        return None
    if ready_status and not pieces:
        return None
    return {
        "job_id": job.get("id"),
        "status": job.get("status"),
        "agent": job.get("agent"),
        "formats": formats,
        "created_at": job.get("created_at"),
        "mission_preview": str(job.get("mission") or "")[:240],
        "result_preview": str(job.get("result") or "")[:400],
        "pieces": visible if ready_status else pieces,
        "can_dismiss": ready_status or status in ("error", "failed", "cancelled"),
    }


_CHANNEL_CONNECTOR = {
    "instagram": "meta",
    "facebook": "meta",
    "linkedin": "linkedin",
    "pinterest": "pinterest",
    "wordpress": "wordpress",
    "brevo": "brevo",
    "newsletter": "brevo",
    "youtube": "youtube",
}

_CHANNEL_LABEL = {
    "korymb": "Espace Korymb",
    "instagram": "Instagram",
    "facebook": "Facebook",
    "linkedin": "LinkedIn",
    "pinterest": "Pinterest",
    "wordpress": "WordPress",
    "brevo": "Newsletter Brevo",
    "newsletter": "Newsletter Brevo",
    "youtube": "YouTube",
}

_LIVRABLE_RE = re.compile(
    r"^#{2,4}\s+\*{0,2}LIVRABLE\s*[—\-–:]\s*\*{0,2}(.+?)\*{0,2}\s*$",
    re.MULTILINE | re.IGNORECASE,
)


def _format_channel(fmt: dict[str, Any]) -> str:
    if fmt.get("id") == "youtube":
        return "youtube"
    rtype = str(fmt.get("resource_type") or "").strip()
    channels = tuple(fmt.get("channels") or ())
    if rtype in ("document", "podcast", "video") and fmt["id"] not in ("article", "newsletter"):
        return "korymb"
    if "instagram" in channels:
        return "instagram"
    if "facebook" in channels:
        return "facebook"
    if "linkedin" in channels:
        return "linkedin"
    if "pinterest" in channels:
        return "pinterest"
    if "wordpress" in channels:
        return "wordpress"
    if "brevo" in channels:
        return "brevo"
    if "youtube" in channels:
        return "youtube"
    return "korymb" if rtype else "mission"


def _connector_for(channel: str) -> dict[str, Any] | None:
    cid = _CHANNEL_CONNECTOR.get(channel)
    if not cid:
        return None
    return next((c for c in tool_connections() if c["id"] == cid), None)


def _extract_livrables(result: str) -> list[dict[str, str]]:
    text = result or ""
    matches = list(_LIVRABLE_RE.finditer(text))
    if not matches:
        body = text.strip()
        return [{"title": "", "body": body}] if body else []
    out: list[dict[str, str]] = []
    for i, match in enumerate(matches):
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out.append({"title": match.group(1).strip()[:200], "body": text[start:end].strip()})
    return out


def _tickets_for_job(job_id: str) -> list[dict[str, Any]]:
    from services.action_queue import list_actions

    jid = (job_id or "").strip()
    if not jid:
        return []
    return [t for t in list_actions(status="pending", limit=80) if str(t.get("job_id") or "") == jid]


def describe_studio_pieces(job: dict[str, Any]) -> list[dict[str, Any]]:
    source = str(job.get("source") or "")
    formats = [p for p in source.split(":", 1)[-1].split(",") if p] if source.startswith("studio:") else []
    result = str(job.get("result") or "")
    file_ids = re.findall(r"rfil-[a-zA-Z0-9]+", result)
    livrables = _extract_livrables(result)
    tickets = _tickets_for_job(str(job.get("id") or ""))
    status = str(job.get("status") or "")
    ready_status = status in ("completed", "done")
    pieces: list[dict[str, Any]] = []
    for i, fid in enumerate(formats):
        fmt = FORMAT_BY_ID.get(fid) or {}
        channel = _format_channel(fmt) if fmt else "korymb"
        in_app = channel == "korymb" or str(fmt.get("resource_type") or "") in ("document", "podcast", "video")
        if fid == "article":
            in_app = True
            channel = "wordpress"
        conn = _connector_for(channel)
        liv = livrables[i] if i < len(livrables) else (livrables[0] if livrables else {"title": "", "body": ""})
        platform_ticket = next(
            (
                t
                for t in tickets
                if str((t.get("payload") or {}).get("platform") or t.get("kind") or "").lower()
                in {channel, "social" if channel in ("instagram", "facebook", "linkedin") else channel, "wordpress" if channel == "wordpress" else ""}
            ),
            None,
        )
        if not platform_ticket and channel in ("instagram", "facebook", "linkedin", "pinterest"):
            platform_ticket = next(
                (t for t in tickets if t.get("kind") == "social" and str((t.get("payload") or {}).get("platform") or "") == channel),
                None,
            )
        if not platform_ticket and channel == "wordpress":
            platform_ticket = next((t for t in tickets if t.get("kind") == "wordpress"), None)
        if not platform_ticket and channel in ("brevo", "newsletter"):
            platform_ticket = next((t for t in tickets if "newsletter" in str(t.get("kind") or "") or "brevo" in str(t.get("title") or "").lower()), None)
        connector_ready = True if channel == "korymb" else bool(conn and conn.get("configured"))
        can_in_app = in_app and ready_status and bool(file_ids or (liv.get("body") or "").strip())
        can_channel = (
            ready_status
            and channel not in ("korymb", "mission", "youtube")
            and connector_ready
            and bool(platform_ticket or (liv.get("body") or "").strip())
        )
        pieces.append(
            {
                "format_id": fid,
                "label": str(fmt.get("label") or fid),
                "in_app": in_app,
                "channel": channel,
                "channel_label": _CHANNEL_LABEL.get(channel, channel),
                "resource_type": str(fmt.get("resource_type") or "document") or "document",
                "file_id": file_ids[i] if i < len(file_ids) else (file_ids[0] if file_ids and in_app else ""),
                "title": liv.get("title") or str(fmt.get("label") or "Pièce studio"),
                "body_preview": (liv.get("body") or "")[:400],
                "body": liv.get("body") or "",
                "connector_ready": connector_ready,
                "connector_setup": str((conn or {}).get("setup") or ""),
                "pending_ticket_id": str((platform_ticket or {}).get("id") or ""),
                "can_publish_in_app": can_in_app,
                "can_publish_channel": can_channel,
                "youtube_upload": False,
                "queue_state": _piece_queue_state(job, fid),
            }
        )
    return pieces


def release_studio_piece(
    *,
    job_id: str,
    format_id: str = "",
    target: str = "",
    visibility: str = "participants",
    title: str = "",
) -> dict[str, Any]:
    from database import get_job

    job = get_job(job_id)
    if not job:
        raise ValueError("Production introuvable.")
    status = str(job.get("status") or "")
    if status not in ("completed", "done"):
        raise ValueError("La mission n'est pas encore terminée — impossible de publier.")
    pieces = describe_studio_pieces(job)
    piece = next((p for p in pieces if p["format_id"] == format_id), None) if format_id else (pieces[0] if pieces else None)
    if not piece:
        raise ValueError("Aucune pièce à publier pour cette production.")
    if _piece_queue_state(job, str(piece["format_id"])) != "pending":
        raise ValueError("Cette pièce n’est plus dans la file (déjà publiée ou retirée).")
    dest = (target or "").strip() or ("korymb" if piece["in_app"] and not piece["can_publish_channel"] else piece["channel"])

    def _done(payload: dict[str, Any]) -> dict[str, Any]:
        _mark_studio_piece(str(job.get("id") or ""), str(piece["format_id"]), "published", target=dest)
        payload["queue_state"] = "published"
        return payload

    if dest in ("korymb", "espace", "resource"):
        return _done(
            publish_resource(
                title=(title or piece["title"] or piece["label"]).strip(),
                resource_type=piece["resource_type"],
                visibility=visibility,
                file_id=piece["file_id"],
                notes="",
                job_id=str(job.get("id") or ""),
                body_markdown="" if piece["file_id"] else piece["body"],
            )
        )
    if dest == "youtube":
        if piece["file_id"] or piece["body"]:
            published = publish_resource(
                title=(title or piece["title"] or "Pack YouTube").strip(),
                resource_type="video" if piece["file_id"] else "document",
                visibility=visibility,
                file_id=piece["file_id"],
                notes="Pack YouTube — l’API configurée sert à la recherche, pas à l’upload automatique.",
                job_id=str(job.get("id") or ""),
                body_markdown="" if piece["file_id"] else piece["body"],
            )
            published["message"] = (
                (published.get("message") or "")
                + " YouTube : pas d’upload automatique (clé Data API). La pièce est dans l’espace Korymb."
            )
            return _done(published)
        raise ValueError("YouTube n’a pas d’upload automatique ici. Publiez le pack dans l’espace, ou branchez un export manuel.")
    conn = _connector_for(dest)
    if not conn or not conn.get("configured"):
        setup = str((conn or {}).get("setup") or "/administration/integrations")
        raise ValueError(f"Connecteur {_CHANNEL_LABEL.get(dest, dest)} absent. Branchez-le : {setup}")
    ticket_id = piece.get("pending_ticket_id") or ""
    if ticket_id:
        from services.action_queue import resolve_action

        out = resolve_action(str(ticket_id), decision="approve", source="studio", comment="Validation Studio")
        if not out.get("success"):
            raise ValueError(str(out.get("error") or "Validation du ticket impossible."))
        return _done({
            "ticket": out.get("ticket"),
            "channel": dest,
            "message": f"Publié sur {_CHANNEL_LABEL.get(dest, dest)} (ticket validé).",
        })
    body = ((title or "").strip() + "\n\n" + (piece.get("body") or "")).strip() if (title or "").strip() else (piece.get("body") or "")
    if dest == "wordpress":
        from services.action_executor import _execute_wordpress

        first_line = (piece["title"] or "Article studio").strip()
        html = piece["body"] or body
        result = _execute_wordpress({"title": first_line, "content": html, "html": html})
        if _publish_failed(result):
            raise ValueError(str(result))
        return _done({"channel": "wordpress", "result": result, "message": "Article WordPress publié."})
    if dest in ("instagram", "facebook", "linkedin"):
        from services.action_executor import _execute_social

        result = _execute_social(
            {
                "platform": dest,
                "tool": f"post_{dest}",
                "caption": body or piece["body"],
                "message": body or piece["body"],
            }
        )
        if _publish_failed(result):
            raise ValueError(str(result))
        return _done({
            "channel": dest,
            "result": result,
            "message": f"Publié sur {_CHANNEL_LABEL.get(dest, dest)}.",
        })
    if dest == "pinterest":
        from tools.platforms import run_create_pinterest_pin

        result = run_create_pinterest_pin("", piece["title"] or "Épingle", piece["body"] or body, "", "")
        if _publish_failed(result):
            raise ValueError(str(result))
        return _done({"channel": "pinterest", "result": result, "message": "Épingle Pinterest envoyée (ou simulée)."})
    if dest in ("brevo", "newsletter"):
        from tools.extras import run_send_newsletter

        result = run_send_newsletter(piece["title"] or "Newsletter", piece["body"] or body)
        if _publish_failed(result):
            raise ValueError(str(result))
        return _done({"channel": "brevo", "result": result, "message": str(result)})
    raise ValueError(f"Cible de publication inconnue : {dest}")


def dismiss_studio_piece(*, job_id: str, format_id: str = "", confirm: str = "") -> dict[str, Any]:
    from database import get_job, merge_job_studio_queue

    if (confirm or "").strip() != STUDIO_DISMISS_CONFIRM:
        raise ValueError(f'Tapez {STUDIO_DISMISS_CONFIRM} pour confirmer le retrait de la file.')
    job = get_job(job_id)
    if not job:
        raise ValueError("Production introuvable.")
    source = str(job.get("source") or "")
    if not source.startswith("studio:"):
        raise ValueError("Cette mission n’est pas une production Studio.")
    fid = re.sub(r"[^a-z0-9_]", "", (format_id or "").strip().lower()[:48])
    if not fid:
        merge_job_studio_queue(str(job.get("id") or ""), {"dismissed_job": True})
        return {"ok": True, "dismissed": "job", "message": "Production retirée de la file Studio."}
    _mark_studio_piece(str(job.get("id") or ""), fid, "dismissed")
    remaining = [
        p for p in describe_studio_pieces(get_job(str(job.get("id") or "")) or job)
        if str(p.get("queue_state") or "pending") == "pending"
    ]
    if not remaining:
        merge_job_studio_queue(str(job.get("id") or ""), {"dismissed_job": True})
    label = next((p.get("label") for p in describe_studio_pieces(job) if p.get("format_id") == fid), fid)
    return {"ok": True, "dismissed": fid, "message": f"« {label} » retirée de la file Studio."}


def _parse_job_created(job: dict[str, Any]) -> datetime | None:
    raw = str(job.get("created_at") or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _maybe_notify_stale_studio_pieces() -> None:
    global _STALE_CHECK_AT
    now = time.monotonic()
    if now - float(_STALE_CHECK_AT or 0) < _STALE_CHECK_TTL_S:
        return
    _STALE_CHECK_AT = now
    try:
        notify_stale_studio_pieces()
    except Exception:
        logger.exception("Rappel Studio (pièces non publiées) impossible")


def notify_stale_studio_pieces(*, now: datetime | None = None, days: int = _STALE_DAYS) -> int:
    """Notifie le dirigeant si une pièce Studio n’est pas publiée 2 jours après sa création."""
    from database import list_jobs, merge_job_studio_queue

    cutoff = (now or datetime.utcnow()) - timedelta(days=max(1, int(days)))
    sent = 0
    for job in list_jobs(limit=120):
        source = str(job.get("source") or "")
        if not source.startswith("studio:"):
            continue
        status = str(job.get("status") or "")
        if status not in ("completed", "done"):
            continue
        created = _parse_job_created(job)
        if not created or created > cutoff:
            continue
        studio = _studio_queue(job)
        if studio.get("dismissed_job") is True:
            continue
        pending = [
            p for p in describe_studio_pieces(job)
            if str(p.get("queue_state") or "pending") == "pending"
        ]
        if not pending:
            continue
        if str(studio.get("reminded_at") or "").strip():
            continue
        titles = [str(p.get("title") or p.get("label") or p.get("format_id")) for p in pending]
        job_id = str(job.get("id") or "")
        try:
            from services.director_platform import emit_director_notification

            emit_director_notification(
                kind="studio_stale",
                title="Studio : publication en attente depuis 2 jours",
                body=(
                    "Une production Studio n’a pas encore été validée. "
                    + " · ".join(titles[:4])
                )[:400],
                job_id=job_id,
                action_url="/gestion/studio",
            )
            merge_job_studio_queue(job_id, {"reminded_at": datetime.utcnow().isoformat()})
            sent += 1
        except Exception:
            logger.exception("Notification Studio périmée impossible (job=%s)", job_id)
    return sent


def notify_stale_studio_pieces_everywhere() -> int:
    """Balaye les espaces qui ont des missions Studio (tâche planifiée)."""
    from database import get_conn
    from tenant_context import clear_tenant_context, get_workspace_id, set_tenant_context

    prev = get_workspace_id()
    wids: list[str] = []
    try:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT DISTINCT workspace_id FROM jobs WHERE source LIKE 'studio:%'"
            ).fetchall()
        for row in rows or []:
            data = dict(row) if hasattr(row, "keys") else {"workspace_id": row[0]}
            wid = str(data.get("workspace_id") or "").strip()
            if wid:
                wids.append(wid)
    except Exception:
        logger.exception("Liste des espaces Studio impossible")
        return 0
    total = 0
    try:
        for wid in wids:
            set_tenant_context(workspace_id=wid)
            total += notify_stale_studio_pieces()
    finally:
        if prev:
            set_tenant_context(workspace_id=prev)
        else:
            clear_tenant_context()
    return total


def _publish_failed(text: str) -> bool:
    t = (text or "").strip().lower()
    return (not t) or t.startswith("erreur") or t.startswith("error")


def publish_resource(
    *,
    title: str,
    resource_type: str,
    visibility: str = "internal",
    file_id: str = "",
    resource_url: str = "",
    notes: str = "",
    project_id: str = "",
    job_id: str = "",
    body_markdown: str = "",
) -> dict[str, Any]:
    """Matérialise un fichier (existant ou PDF généré du markdown) en ressource planning."""
    from services.business_db import EVENT_RESOURCE_TYPES, EVENT_VISIBILITIES, create_calendar_event

    rtype = resource_type if resource_type in EVENT_RESOURCE_TYPES and resource_type else "document"
    vis = visibility if visibility in EVENT_VISIBILITIES else "internal"
    label = (title or "").strip()[:300] or "Ressource studio"
    fid = (file_id or "").strip()
    if not fid and body_markdown.strip() and rtype == "document":
        from tools.studio import run_create_branded_pdf

        pdf_out = run_create_branded_pdf(label, body_markdown)
        extracted = _extract_file_id(pdf_out)
        if extracted:
            fid = extracted
        else:
            notes = f"{notes}\n\n{pdf_out}".strip()
    if not fid and not resource_url.strip():
        raise ValueError("Fournissez un fichier généré (file_id) ou le texte à transformer en PDF.")
    note_parts = [notes.strip()]
    if job_id:
        note_parts.append(f"Studio job {job_id}")
    wid = get_workspace_id()
    starts = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    event = create_calendar_event(
        title=label,
        starts_at=starts,
        event_type="ressource",
        project_id=(project_id or "").strip() or None,
        status="planned",
        notes="\n".join(p for p in note_parts if p)[:4000],
        visibility=vis,
        modality="async",
        nature="matiere",
        resource_type=rtype,
        resource_url=(resource_url or "").strip()[:2000],
        resource_file_id=fid,
    )
    return {
        "event": event,
        "workspace_id": wid,
        "message": (
            f"Ressource « {label} » créée ({vis}). "
            "Elle apparaît dans Gestion → Planning et, selon la visibilité, dans l'espace participant."
        ),
    }


def _extract_file_id(tool_text: str) -> str:
    m = re.search(r"rfil-[a-zA-Z0-9]+", tool_text or "")
    return m.group(0) if m else ""
