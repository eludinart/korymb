"""
Starter packs — amorçage optionnel d'un workspace (contenu, pas un vertical moteur).

Le moteur Korymb reste neutre. Un pack copie playbooks / templates / mémoire initiale
dans le workspace ; l'utilisateur peut tout modifier ensuite.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

BLANK_PACK_ID = "blank"

STARTER_PACKS: dict[str, dict[str, Any]] = {
    BLANK_PACK_ID: {
        "id": BLANK_PACK_ID,
        "label": "Commencer vide",
        "description": (
            "Espace générique. "
            "À spécialiser au fil de l'usage (mémoire, équipes, demandes)."
        ),
        "memory_seed": "",
        "playbooks": [],
        "mission_templates": [],
    },
    "accompagnement": {
        "id": "accompagnement",
        "label": "Accompagnement",
        "description": (
            "Amorçage pour une pratique d'accompagnement : notes de séance, "
            "accords / devis, ateliers, courriers de liaison. Modifiable ensuite."
        ),
        "memory_seed": (
            "Contexte d'activité (à compléter) : pratique d'accompagnement.\n"
            "- Posture : respect de la confidentialité, pas de données sensibles brutes "
            "inutiles dans les consignes aux agents ; préférer initiales ou identifiants internes.\n"
            "- Cadre : séances individuelles / couple / ateliers selon l'offre de l'espace.\n"
            "- Objectif des agents : alléger l'administratif et la préparation, "
            "sans se substituer au jugement professionnel du praticien.\n"
        ),
        "playbooks": [
            {
                "slug": "notes-seance",
                "name": "Notes de séance → fiche de suivi",
                "description": "Transformer des notes brutes en fiche de suivi structurée.",
                "category": "accompagnement",
                "steps": {
                    "mission": (
                        "À partir de notes de séance brutes fournies par le dirigeant, produire une "
                        "fiche de suivi consultant claire : contexte, thèmes abordés, points de vigilance, "
                        "pistes entre deux séances, prochaine étape. "
                        "Anonymiser (initiales ou identifiant contact Gestion). "
                        "Marquer #### LIVRABLE — Fiche de suivi. Pas d'envoi externe."
                    ),
                    "agents": ["coordinateur"],
                    "mission_config": {"mode": "cio", "require_user_validation": True},
                },
            },
            {
                "slug": "accord-devis",
                "name": "Accord d'accompagnement ou devis",
                "description": "Rédiger un accord ou un devis prêt à valider.",
                "category": "accompagnement",
                "steps": {
                    "mission": (
                        "Rédiger un accord d'accompagnement ou un devis (prestations, durée, tarif, "
                        "modalités d'annulation) adapté à l'activité du workspace. "
                        "Si devis structuré : utiliser gestion_create_quote. "
                        "Sinon #### LIVRABLE — Accord / devis (texte intégral). "
                        "Validation dirigeant avant envoi."
                    ),
                    "agents": ["comptable", "commercial"],
                },
            },
            {
                "slug": "atelier-cercle",
                "name": "Préparer un atelier ou cercle",
                "description": "Trame d'atelier / cercle de parole + créneau agenda.",
                "category": "accompagnement",
                "steps": {
                    "mission": (
                        "Préparer un atelier ou cercle de parole : intention, déroulé horaire, "
                        "consignes d'accueil, matériel, points de vigilance. "
                        "Proposer un créneau via create_calendar_event (file d'arbitrage). "
                        "#### LIVRABLE — Trame atelier."
                    ),
                    "agents": ["coordinateur", "community_manager"],
                },
            },
            {
                "slug": "courrier-liaison",
                "name": "Courrier de liaison / compte-rendu",
                "description": "Compte-rendu sobre pour confrère ou médecin traitant.",
                "category": "accompagnement",
                "steps": {
                    "mission": (
                        "Rédiger un courrier de liaison ou compte-rendu pour un confrère / "
                        "médecin traitant : faits utiles, sans jugement excessif, ton professionnel. "
                        "Pas de données de santé superflues. "
                        "send_email = file d'arbitrage uniquement. "
                        "#### LIVRABLE — Courrier de liaison."
                    ),
                    "agents": ["commercial", "coordinateur"],
                },
            },
        ],
        "mission_templates": [
            {
                "slug": "seance-express",
                "name": "Préparer une séance",
                "description": "Cadrer rapidement la prochaine séance avec un consultant.",
                "agent": "coordinateur",
                "mission_text": (
                    "Préparer la prochaine séance avec {{consultant}} : rappel du fil, "
                    "intention de la séance, 3 questions d'ouverture, consignes éventuelles."
                ),
                "variables": ["consultant"],
                "config": {"mode": "cio", "require_user_validation": True},
            },
        ],
    },
    "contenu": {
        "id": "contenu",
        "label": "Création de contenu",
        "description": (
            "Amorçage éditorial : articles, packs réseaux, PDF brandés. "
            "Compléter la charte dans la mémoire partagée."
        ),
        "memory_seed": (
            "Contexte éditorial (à compléter) :\n"
            "- Voix / ton de la marque : …\n"
            "- Publics cibles : …\n"
            "- Canaux prioritaires (site, newsletter, réseaux) : …\n"
            "- À éviter (sujets, formulations) : …\n"
        ),
        "playbooks": [
            {
                "slug": "article-blog",
                "name": "Article de blog",
                "description": "Article SEO aligné sur la mémoire ; publication après validation.",
                "category": "contenu",
                "steps": {
                    "mission": (
                        "Rédiger un article web (SEO) aligné sur la mémoire du workspace. "
                        "Utiliser wordpress_create_post si configuré — publication réelle après validation. "
                        "#### LIVRABLE — Article."
                    ),
                    "agents": ["community_manager"],
                },
            },
            {
                "slug": "pack-social",
                "name": "Pack réseaux (IG + FB + LinkedIn)",
                "description": "Un angle, trois déclinaisons. Publication après Décisions.",
                "category": "contenu",
                "steps": {
                    "mission": (
                        "À partir d'un même angle éditorial, produire : "
                        "1) post Instagram + visuel generate_image, 2) post Facebook plus long, "
                        "3) post LinkedIn. Utiliser post_instagram / post_facebook / post_linkedin (HITL)."
                    ),
                    "agents": ["community_manager"],
                },
            },
            {
                "slug": "pdf-brand",
                "name": "Document PDF brandé",
                "description": "Fiche ou module pédagogique en PDF.",
                "category": "contenu",
                "steps": {
                    "mission": (
                        "Rédiger un document pédagogique (2–6 pages) puis create_branded_pdf. "
                        "#### LIVRABLE — <titre>."
                    ),
                    "agents": ["community_manager"],
                },
            },
        ],
        "mission_templates": [
            {
                "slug": "brief-editorial",
                "name": "Brief éditorial",
                "description": "Clarifier un brief avant production.",
                "agent": "community_manager",
                "mission_text": (
                    "À partir du sujet « {{sujet}} », produire un brief éditorial : "
                    "angle, promesse, structure, CTA, canal recommandé."
                ),
                "variables": ["sujet"],
                "config": {"mode": "cio", "require_user_validation": True},
            },
        ],
    },
}


def normalize_pack_id(raw: str | None) -> str:
    key = (raw or BLANK_PACK_ID).strip().lower()
    if key not in STARTER_PACKS:
        raise ValueError(
            f"Modèle inconnu : {raw!r}. Choisir parmi : {', '.join(sorted(STARTER_PACKS))}."
        )
    return key


def list_starter_packs() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pack in STARTER_PACKS.values():
        out.append(
            {
                "id": pack["id"],
                "label": pack["label"],
                "description": pack["description"],
                "playbook_count": len(pack.get("playbooks") or []),
                "mission_template_count": len(pack.get("mission_templates") or []),
                "has_memory_seed": bool(str(pack.get("memory_seed") or "").strip()),
            }
        )
    return out


def get_starter_pack(pack_id: str) -> dict[str, Any] | None:
    return STARTER_PACKS.get(normalize_pack_id(pack_id))


def _pack_entity_id(pack_id: str, workspace_id: str, kind: str, slug: str) -> str:
    suffix = workspace_id.replace("ws-", "")[:10]
    return f"pack-{pack_id}-{suffix}-{kind}-{slug}"[:120]


def apply_starter_pack(workspace_id: str, pack_id: str) -> dict[str, Any]:
    """
    Applique un pack au workspace (idempotent : skip playbooks/templates déjà présents).
    blank = metadata seulement (le seed générique vient de seed_workspace_defaults).
    """
    from database import (
        get_enterprise_memory,
        get_mission_template,
        get_playbook,
        merge_enterprise_contexts,
        upsert_mission_template,
        upsert_playbook,
    )
    from tenant_context import clear_tenant_context, get_workspace_id, set_tenant_context
    from workspace_db import get_workspace_by_id, set_workspace_starter_pack_id

    wid = (workspace_id or "").strip()
    if not wid:
        raise ValueError("workspace_id manquant.")
    if not get_workspace_by_id(wid):
        raise ValueError("Espace introuvable.")

    pid = normalize_pack_id(pack_id)
    pack = STARTER_PACKS[pid]

    prev = get_workspace_id()
    set_tenant_context(workspace_id=wid)
    created_playbooks = 0
    skipped_playbooks = 0
    created_templates = 0
    skipped_templates = 0
    memory_applied = False
    try:
        if pid != BLANK_PACK_ID:
            for pb in pack.get("playbooks") or []:
                pb_id = _pack_entity_id(pid, wid, "pb", str(pb["slug"]))
                if get_playbook(pb_id):
                    skipped_playbooks += 1
                    continue
                upsert_playbook(
                    pb_id,
                    name=str(pb["name"]),
                    description=str(pb.get("description") or ""),
                    category=str(pb.get("category") or pid)[:32],
                    steps=pb.get("steps") or {},
                )
                created_playbooks += 1

            for tpl in pack.get("mission_templates") or []:
                tpl_id = _pack_entity_id(pid, wid, "tpl", str(tpl["slug"]))
                if get_mission_template(tpl_id):
                    skipped_templates += 1
                    continue
                upsert_mission_template(
                    tpl_id,
                    name=str(tpl["name"]),
                    description=str(tpl.get("description") or ""),
                    agent=str(tpl.get("agent") or "coordinateur"),
                    mission_text=str(tpl.get("mission_text") or ""),
                    variables=list(tpl.get("variables") or []),
                    config=dict(tpl.get("config") or {}),
                )
                created_templates += 1

            seed = str(pack.get("memory_seed") or "").strip()
            if seed:
                mem = get_enterprise_memory()
                current_global = str((mem.get("contexts") or {}).get("global") or "").strip()
                if not current_global:
                    merge_enterprise_contexts({"global": seed})
                    memory_applied = True

        set_workspace_starter_pack_id(wid, pid)
    finally:
        if prev:
            set_tenant_context(workspace_id=prev)
        else:
            clear_tenant_context()

    logger.info(
        "Starter pack %s appliqué à %s (pb +%s/~%s, tpl +%s/~%s, memory=%s)",
        pid,
        wid,
        created_playbooks,
        skipped_playbooks,
        created_templates,
        skipped_templates,
        memory_applied,
    )
    return {
        "workspace_id": wid,
        "starter_pack_id": pid,
        "label": pack["label"],
        "created_playbooks": created_playbooks,
        "skipped_playbooks": skipped_playbooks,
        "created_templates": created_templates,
        "skipped_templates": skipped_templates,
        "memory_applied": memory_applied,
    }
