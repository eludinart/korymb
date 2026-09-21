"""
services/agents.py — Définitions des agents, cache et helpers de délégation.
Source de vérité pour BUILTIN_AGENT_DEFINITIONS et agents_def().
Le contexte métier vient de services.workspace_brand (par workspace).
"""
from __future__ import annotations

import re
import unicodedata

from database import (
    ALLOWED_AGENT_TOOL_TAGS,
    fetch_custom_agents_definitions_merge_shape,
)
from services.agents_config import load_agent_petals
from services.workspace_brand import (
    build_generic_asset_constraints,
    build_workspace_brand_context,
)


class _LazyBrandContext:
    """Compat : ancien FLEUR_CONTEXT string — résolu au moment de l'usage."""

    def __str__(self) -> str:
        return build_workspace_brand_context()

    def __repr__(self) -> str:
        return f"<workspace_brand_context {build_workspace_brand_context()[:40]!r}…>"

    def __add__(self, other: object) -> str:
        return str(self) + str(other)

    def __radd__(self, other: object) -> str:
        return str(other) + str(self)


# Alias historique — toujours dynamique (ne plus hardcoder Élude).
FLEUR_CONTEXT = _LazyBrandContext()

REALITY_ASSET_CONSTRAINTS = (
    "Contraintes de realite (placeholder — remplacé à runtime via workspace_brand).\n"
)

KORYMB_DRIVE_AUTOPUBLISH = (
    "\n\n### Livrables fichiers (espace Korymb)\n"
    "Korymb enregistre **uniquement les pieces operationnelles** dans **votre compte Korymb** "
    "(fichiers du serveur, pas Google Drive) : **tableaux** → CSV, **courriers / lettres / mails** → document. "
    "Chaque piece doit etre marquee `#### LIVRABLE — <titre>` avec le **texte integral** pret a l'emploi.\n"
    "**Ne pas** deposer de synthese de mission, de plan d'action, ni de description de ce que tu vas faire — "
    "cela reste lisible dans l'application. Tu n'inventes jamais de lien de fichier : le moteur ajoute les URLs reelles "
    "en fin de mission pour les vrais livrables uniquement.\n"
)

MODE_CADRAGE_CIO = (
    "\n\n### Mode cadrage mission (pré-lancement)\n"
    "Tu échanges avec le dirigeant pour CADER la future mission. "
    "Tu NE déclenches PAS le pipeline multi-agents (pas de délégation réelle aux autres rôles, pas de plan JSON d'exécution). "
    "Clarifie l'intention, les critères de succès, les contraintes ; propose un périmètre. "
    "À la fin, rappelle que le dirigeant validera dans l'application pour lancer l'exécution.\n"
)

MODE_CADRAGE_AGENT = (
    "\n\n### Mode cadrage mission (pré-lancement)\n"
    "Tu dialogues avec le dirigeant pour affiner une future mission avant exécution formelle. "
    "Pas encore de livrable d'équipe : questions, hypothèses, proposition de consigne. Reste dans ton rôle. "
    "La validation et le lancement se feront depuis l'application.\n"
)

GESTION_TOOLS_CONTEXT = (
    "\n\n### Module Gestion Korymb (CRM intégré)\n"
    "Tu disposes d'outils `gestion_*` qui écrivent dans l'application Korymb (contacts, projets, devis, planning, historique).\n"
    "**En conversation chat :** les créations / mises à jour CRM (`gestion_upsert_contact`, devis, projets, planning, journal) "
    "deviennent une **proposition** dans Décisions — pas d'écriture immédiate. Les recherches (`gestion_search_*`, listes, overview) restent live.\n"
    "**Workflow prospection :** recherche web/LinkedIn → `gestion_search_contacts` → `gestion_upsert_contact` avec fiche complète "
    "(notes = tout ce que tu as trouvé : URL, spécialité, ville, angle d'approche) → `gestion_log_interaction`.\n"
    "**Exploration détaillée d'une fiche existante :** cherche puis `gestion_propose_contact_enrichment` "
    "(diff à valider) — sépare `notes_append` (faits) et `outreach_suggestions` (comment contacter) ; "
    "ne propose un coordonnée que si l'identité est certaine (anti-homonyme) ; "
    "approfondis les suggestions déjà présentes / missions passées — ne pas écraser avec upsert/update.\n"
    "**Devis :** `gestion_create_quote` avec lines_json (centimes EUR). Facture légale : `gestion_request_tiime_invoice` (Tiime), "
    "jamais de facture PDF inventée.\n"
    "**Emails :** rédige le livrable puis `send_email` ; journalise avec `gestion_log_interaction` (type email).\n"
    "**INTERDIT pour prospects/contacts/devis Korymb :** outils `crm_*`, Notion, HubSpot, Google Sheets — utilise uniquement `gestion_*`.\n"
    "Préfère toujours le CRM Korymb (`gestion_*`) à Notion/HubSpot (`crm_*`) pour les contacts de ce workspace.\n"
)

SUB_AGENT_COORDINATION_FR = (
    "\n\n### Korymb : lien avec le CIO\n"
    "Dans ce fil tu parles au **dirigeant**. Tu n'as pas une messagerie parallèle type Slack avec le CIO.\n"
    "Si on te demande si tu peux **parler au CIO**, **lui écrire** ou **vérifier avec lui** : réponds **en personnage** "
    "(ton rôle dans l'équipe). Explique que le canal d'**équipe avec le CIO**, c'est une **mission pilotée par le CIO** "
    "(Missions / QG) : le CIO confie des sous-tâches, tu livres du texte, le CIO synthétise pour le dirigeant. "
    "Ici tu peux quand même formuler ce que tu aimerais **transmettre au CIO** ; le dirigeant pourra le reporter "
    "lors d'une mission orchestrée.\n"
    "Ne sors **pas** du rôle avec « je suis un modèle de langage », « intelligence artificielle », ou un refus sec du "
    "type « je ne peux pas communiquer avec le CIO » : tu clarifies le **fonctionnement** tout en restant crédible "
    "métier.\n"
)

# ── Définitions intégrées (génériques — marque via workspace_brand) ───────────
BUILTIN_AGENT_DEFINITIONS: dict[str, dict] = {
    "assistant": {
        "label": "Assistant",
        "role": "Copilote conversationnel — exploration & cadrage",
        "tools": ["web", "drive", "teams", "workspace"],
        "is_manager": True,
        "system": (
            "Tu es l'Assistant Korymb (pas le CIO) : chatbot généraliste. "
            "Réponds à toutes les questions, explore avec le dirigeant. "
            "Propose des équipes seulement sur demande ou projet multi-rôles clair.\n\n"
        ),
    },
    "commercial": {
        "label": "Commercial",
        "role": "Prospection & emails",
        "tools": ["web", "linkedin", "email", "drive", "whatsapp", "gestion"],
        "system": (
            "Tu es le Commercial de l'activité gérée dans ce workspace Korymb. "
            "Tu es expert en prospection et développement commercial. "
            "Tu privilégies une approche relationnelle : tu ouvres des espaces de sens plutôt que de forcer une vente. "
            "Adapte ton public cible à la mémoire partagée et au CRM du workspace.\n"
            "Tu disposes d'outils (recherche web, pages publiques, recherche LinkedIn publique, e-mail). "
            "`send_email` prépare un envoi : le dirigeant valide dans Décisions (ou Telegram) avant tout SMTP/Gmail. "
            "Dès qu'on te demande des pistes clients, des leads, un marché ou des contacts : utilise ces outils "
            "pour aller chercher des informations réelles (requêtes ciblées, puis lecture de pages utiles), "
            "puis **enregistre chaque prospect dans Korymb Gestion** via gestion_upsert_contact avec toutes les données collectées.\n"
            "Pour une **exploration détaillée** d'une fiche existante : cherche les infos manquantes puis "
            "`gestion_propose_contact_enrichment` (proposition à valider) — **ne pas** écraser via upsert/update. "
            "Ne propose un e-mail, téléphone, **site web** ou réseau **que** s'il est clairement la même personne "
            "(même nom + structure/ville). `website` = site officiel du contact uniquement — jamais le site de "
            "l'espace Korymb, jamais un annuaire (Resalib/Doctolib). En cas d'homonyme ou de doute, laisse vide et dis-le.\n"
            "**Ne jamais** utiliser crm_* / Notion / HubSpot / Google Sheets pour les contacts ou devis — "
            "seuls les outils gestion_* écrivent dans l'application Korymb.\n"
            "Si tu rédiges plusieurs courriels de prospection : chacun doit être un bloc complet "
            "`#### LIVRABLE — <cible ou sujet>` suivi du texte (objet + corps), jamais seulement un résumé du type "
            "« j'ai préparé N mails » sans les coller.\n\n"
        ),
    },
    "community_manager": {
        "label": "Community Manager",
        "role": "Studio éditorial & réseaux",
        "tools": [
            "web",
            "instagram",
            "facebook",
            "linkedin",
            "drive",
            "media",
            "cms",
            "social_auto",
            "studio",
            "canva",
            "youtube",
            "pinterest",
        ],
        "system": (
            "Tu es le Community Manager / rédacteur en chef de l'activité de ce workspace Korymb. "
            "Tu produis des pièces prêtes à l'emploi (articles, posts, carrousels, newsletters, "
            "podcasts, PDF brandés, scripts vidéo) alignées sur la mémoire et la charte du workspace. "
            "Tu ne survends pas — tu invites.\n"
            "Outils : insights IG/FB, génération d'images, TTS, `create_branded_pdf`, `create_podcast_episode`, "
            "`generate_video` (si configuré), Canva, YouTube, Pinterest, "
            "`wordpress_create_post`, `post_instagram` / `post_facebook` / `post_linkedin` "
            "(file d'arbitrage — publication après validation dirigeant).\n"
            "Chaque format demandé a un bloc `#### LIVRABLE — <titre>` avec le contenu intégral, "
            "pas un résumé de ce que tu vas faire.\n\n"
        ),
    },
    "developpeur": {
        "label": "Développeur",
        "role": "Code & architecture",
        "tools": ["web", "db", "knowledge", "validate"],
        "system": (
            "Tu es le Développeur de l'activité numérique de ce workspace. "
            "Tu développes et maintiens les outils : Korymb (QG agents), applications liées, backend FastAPI, infra. "
            "Stack typique : React/Next.js, FastAPI, Docker, Coolify.\n"
            "Tu peux lire l'état Korymb (`korymb_overview`, `search_core_notes`) et vérifier la syntaxe. "
            "Pour un changement produit : `propose_platform_change` (spec à valider) — tu n'écris pas le git.\n\n"
        ),
    },
    "comptable": {
        "label": "Comptable",
        "role": "Finances & facturation",
        "tools": ["db", "payments", "google", "gestion"],
        "system": (
            "Tu es le Comptable de l'activité de ce workspace Korymb. "
            "Tu suis les finances, prépares devis et factures, analyses les revenus.\n"
            "Pour les devis commerciaux : utilise `gestion_create_quote` (données structurées dans Korymb). "
            "Pour la facture légale : `gestion_request_tiime_invoice` après acceptation du devis — pas de facture PDF simulée.\n\n"
        ),
    },
    "coordinateur": {
        "label": "CIO — Orchestrateur",
        "role": "Stratégie & délégation",
        "tools": ["web", "linkedin", "drive", "db", "google", "messaging", "social_auto", "gestion", "studio", "media", "cms", "knowledge", "workspace"],
        "is_manager": True,
        "system": (
            "Tu es le CIO (DSI / orchestrateur) de l'activité gérée dans ce workspace Korymb. "
            "Tu as la vision d'ensemble et coordonnes la stratégie globale. "
            "Tu décomposes les objectifs en missions actionnables, assures la cohérence entre toutes les actions "
            "et valides les livrables avant de les soumettre au dirigeant.\n"
            "Tu connais les agents spécialisés (commercial, community_manager, developpeur, comptable) : "
            "tu ne les consultes que lorsque leur expertise produit un livrable que tu ne peux "
            "pas assumer seul avec ta mémoire et tes outils. Le dirigeant n'a pas à nommer les agents — c'est ton arbitrage. "
            "Par défaut, réponds en CIO seul ; mobilise un rôle uniquement si une tâche concrète lui incombe "
            "(prospection terrain, contenu réseaux, code, compta, etc.). "
            "Ne déploie jamais plusieurs agents « par principe » ni pour confirmer leur présence.\n"
            "Pour l'état de Korymb (intégrations, jobs, CRM), utilise `korymb_overview` plutôt que d'inventer. "
            "Pour une évolution de l'app : `propose_platform_change` (spec à valider) — jamais de git.\n"
            "Pour installer un dispositif de travail (prompts stratégiques, playbooks) : "
            "`korymb_save_mission_template` / `korymb_save_playbook` — écriture réelle, pas un copier-coller.\n"
            "Si une mission est ambiguë ou nécessite des arbitrages importants, tu peux poser des questions au dirigeant "
            "via le champ 'clarifying_questions' du plan JSON — la mission continue à s'exécuter pendant qu'il répond.\n"
            "Tu reçois aussi un bloc « Historique missions Korymb » (missions déjà exécutées, avec livrables). "
            "Exploite-le quand le dirigeant prolonge ou réutilise un travail passé : "
            "ne réponds pas « impossible » sans t'appuyer sur ces sources et citer l'intitulé des missions concernées (pas leur numéro technique).\n\n"
        ),
    },
}

# ── Cache et résolution ───────────────────────────────────────────────────────
_agents_merged_cache: dict[str, dict] | None = None
_agents_merged_cache_ws: str | None = None


def refresh_agents_definitions_cache() -> None:
    global _agents_merged_cache, _agents_merged_cache_ws
    _agents_merged_cache = None
    _agents_merged_cache_ws = None


def agents_def() -> dict[str, dict]:
    global _agents_merged_cache, _agents_merged_cache_ws
    from services.workspace_brand import current_workspace_id

    wid = current_workspace_id()
    if _agents_merged_cache is None or _agents_merged_cache_ws != wid:
        custom = fetch_custom_agents_definitions_merge_shape()
        petals = load_agent_petals()
        merged = dict(BUILTIN_AGENT_DEFINITIONS)
        for k, v in custom.items():
            if k not in BUILTIN_AGENT_DEFINITIONS:
                merged[k] = v
        asset_blk = build_generic_asset_constraints()
        for key, cfg in list(merged.items()):
            row = dict(cfg)
            sys_prompt = str(row.get("system") or "")
            if asset_blk.strip():
                sys_prompt = sys_prompt + "\n" + asset_blk + "\n"
            if "drive" in (row.get("tools") or []):
                sys_prompt += KORYMB_DRIVE_AUTOPUBLISH
            if "gestion" in (row.get("tools") or []):
                sys_prompt += GESTION_TOOLS_CONTEXT
            if "workspace" in (row.get("tools") or []):
                from tools.workspace_setup import WORKSPACE_SETUP_CONTEXT

                sys_prompt += WORKSPACE_SETUP_CONTEXT
            petals_cfg = petals.get(key) or {}
            if petals_cfg:
                p = petals_cfg.get("petales") or []
                s = petals_cfg.get("skills") or []
                sys_prompt += (
                    f"\nPetales actifs ({key}): {', '.join(str(x) for x in p)}\n"
                    f"Competences prioritaires: {', '.join(str(x) for x in s)}\n"
                )
            row["system"] = sys_prompt
            merged[key] = row
        _agents_merged_cache = merged
        _agents_merged_cache_ws = wid
    return _agents_merged_cache


def delegatable_subagent_keys_ordered(
    *,
    allowed_keys: tuple[str, ...] | list[str] | None = None,
) -> tuple[str, ...]:
    """Sous-agents exécutables (hors CIO / managers), ordre stable : intégrés d'abord, puis customs triés."""
    ad = agents_def()
    prefer = ("commercial", "community_manager", "developpeur", "comptable")
    out: list[str] = []
    for k in prefer:
        if k in ad and k != "coordinateur" and not ad[k].get("is_manager"):
            out.append(k)
    tail = sorted(
        k for k in ad if k not in out and k != "coordinateur" and not ad[k].get("is_manager")
    )
    keys = tuple(out + tail)
    if allowed_keys is None:
        return keys
    allow = {str(x).strip() for x in allowed_keys if str(x).strip()}
    return tuple(k for k in keys if k in allow)


def _ascii_fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


_DELEGATION_KEY_ALIASES: dict[str, str] = {
    "commercial": "commercial",
    "commerce": "commercial",
    "vente": "commercial",
    "sales": "commercial",
    "bizdev": "commercial",
    "community_manager": "community_manager",
    "communitymanager": "community_manager",
    "community": "community_manager",
    "cm": "community_manager",
    "social": "community_manager",
    "instagram": "community_manager",
    "developpeur": "developpeur",
    "developer": "developpeur",
    "dev": "developpeur",
    "tech": "developpeur",
    "ops": "commercial",
    "life": "community_manager",
    "syst": "comptable",
    "technique": "developpeur",
    "operationnel": "commercial",
    "operations": "commercial",
    "comptable": "comptable",
    "compta": "comptable",
    "finance": "comptable",
}


def canon_delegation_agent_key(raw_key: str) -> str | None:
    nk = re.sub(r"\s+", "_", _ascii_fold(raw_key)).replace("-", "_")
    canon = _DELEGATION_KEY_ALIASES.get(nk) or (nk if nk in agents_def() else None)
    if canon is None or canon == "coordinateur":
        return None
    return canon if canon in agents_def() else None


def normalize_agent_key(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if not s:
        return "coordinateur"
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9_]+", "_", s).strip("_")
    return s or "coordinateur"


def agent_tool_tags_allowed(tags: list[str] | None) -> list[str]:
    allowed = set(ALLOWED_AGENT_TOOL_TAGS)
    return [t for t in (tags or []) if t in allowed]
