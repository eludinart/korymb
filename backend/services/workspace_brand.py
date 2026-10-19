"""
Contexte métier injecté aux agents — par workspace, pas de marque hardcodée.

Le pack legacy Élude In Art / Fleur n'est servi que pour `ws-default-legacy`
(et si la mémoire partagée n'a pas encore de contexte global).
"""
from __future__ import annotations

from typing import Any

# Workspace créé au bootstrap historique de l'instance Élude.
LEGACY_ELUDE_WORKSPACE_ID = "ws-default-legacy"

# Conservé pour la flotte métier de l'instance legacy uniquement.
_LEGACY_BRAND_CONTEXT = (
    "Contexte métier Élude In Art :\n"
    "- Créateur : Éric (Tourves, 83170, Var) — eludinart@gmail.com — 0659582428\n"
    "- Site : eludein.art | App : app-fleurdamours.eludein.art\n"
    "- Produit phare : Tarot Fleur d'ÅmÔurs (65 cartes, outil d'analyse systémique des relations)\n"
    "  → 4 familles : 8 formes d'amour (Agapé, Éros, Philia, Storgé, Pragma, Ludus, Mania, Philautia), "
    "cycle végétal (Racines→Nectar), éléments (Feu, Éther, Eau, Air, Terre + cycles), cycle de la vie\n"
    "  → Pas de divination — cartographie systémique des dynamiques relationnelles\n"
    "  → Cible : coachs, thérapeutes, facilitateurs, couples, professionnels de l'accompagnement\n"
    "- Autres services : constellations systémiques, accompagnement relationnel, VIBRÆ (son), "
    "SÏvåñà (écolieu Haut-Var), stages & ateliers\n"
    "- Modules Pro : 7 modules pour former des professionnels à l'usage du tarot\n"
    "- Business model : vente tarot physique, séances individuelles, modules pro, abonnements Stripe\n"
)

_LEGACY_ASSET_CONSTRAINTS = (
    "Contraintes de realite (actifs):\n"
    "- Actif SIVANA: ecolieu et ecosysteme vivant, toute proposition doit rester executable en contexte terrain.\n"
    "- Actif TI SPOUN: ancrage local, artisanal et relationnel ; eviter les strategies detachees de la capacite reelle.\n"
    "- Science de la Fleur d'Amours: posture non divinatoire, systemique, ethiquement responsable.\n"
)

_GENERIC_ASSET_CONSTRAINTS = (
    "Contraintes de realite:\n"
    "- Propose uniquement des actions executables avec les ressources et outils réellement disponibles.\n"
    "- Respecte la charte et la mémoire partagée du workspace ; n'invente pas d'actifs ou de marques.\n"
)

_ISOLATED_TEAM_IDENTITY = (
    "Identité de cette équipe : uniquement son brief et sa mémoire d'équipe.\n"
    "N'emprunte pas de marque, produit, titre d'ouvrage ou nom de fichier "
    "d'un autre périmètre du workspace (flotte Entreprise comprise), "
    "sauf s'ils figurent explicitement dans la mémoire d'équipe ou la consigne du dirigeant.\n"
)


def current_workspace_id() -> str:
    try:
        from workspace_db import ws_id

        return (ws_id() or "").strip()
    except Exception:
        return ""


def is_legacy_elude_workspace(workspace_id: str | None = None) -> bool:
    wid = (workspace_id if workspace_id is not None else current_workspace_id()).strip()
    return wid == LEGACY_ELUDE_WORKSPACE_ID


def _workspace_label(wid: str) -> str:
    if not wid:
        return ""
    try:
        from workspace_db import get_workspace_by_id

        row = get_workspace_by_id(wid)
        if isinstance(row, dict):
            return str(row.get("name") or "").strip()
    except Exception:
        pass
    return ""


def _memory_global_context() -> str:
    try:
        from database import get_enterprise_memory

        mem = get_enterprise_memory()
        contexts = mem.get("contexts") if isinstance(mem, dict) else None
        if not isinstance(contexts, dict):
            return ""
        raw = contexts.get("global")
        return raw.strip() if isinstance(raw, str) else ""
    except Exception:
        return ""


def build_workspace_brand_context() -> str:
    """Bloc texte métier pour system prompts (chat / missions)."""
    wid = current_workspace_id()
    label = _workspace_label(wid)
    global_ctx = _memory_global_context()

    if global_ctx:
        header = f"Contexte métier ({label}) :" if label else "Contexte métier :"
        return f"{header}\n{global_ctx}\n"

    if is_legacy_elude_workspace(wid):
        return _LEGACY_BRAND_CONTEXT

    if label:
        return (
            f"Contexte métier : activité « {label} » gérée dans Korymb.\n"
            "Utilise la mémoire partagée du workspace, le CRM et les outils connectés pour les détails. "
            "N'invente pas de marque, produit ou coordonnées absents de ces sources.\n"
        )

    return (
        "Contexte métier : activité gérée dans Korymb.\n"
        "Utilise la mémoire partagée du workspace et les outils disponibles. "
        "N'invente pas d'identité de marque.\n"
    )


def build_generic_asset_constraints() -> str:
    """Contraintes sans marque — à coller dans les fiches agents (le pack legacy va au runtime)."""
    return _GENERIC_ASSET_CONSTRAINTS


def build_workspace_asset_constraints() -> str:
    if is_legacy_elude_workspace():
        return _LEGACY_ASSET_CONSTRAINTS
    return _GENERIC_ASSET_CONSTRAINTS


def group_sees_workspace_identity(agent_group_id: str | None = None) -> bool:
    """True si ce run a droit au pack marque / fichiers / mémoire partagée du workspace."""
    gid = (agent_group_id or "").strip()
    if not gid:
        return True
    try:
        from services.agent_groups import ENTERPRISE_GROUP_ID, get_group_memory, group_memory_scope

        if gid == ENTERPRISE_GROUP_ID:
            return True
        scope = group_memory_scope(gid)
        if scope == "enterprise":
            return True
        if scope == "none":
            return False
        mem = get_group_memory(gid)
        return bool(mem.get("inherit_shared"))
    except Exception:
        return False


def workspace_identity_block(agent_group_id: str | None = None) -> str:
    """
    Bloc identité injecté au runtime.
    Équipe isolée (memory_scope=group sans héritage, ou none) : pas de pack Fleur / Élude.
    """
    if group_sees_workspace_identity(agent_group_id):
        brand = build_workspace_brand_context().strip()
        assets = build_workspace_asset_constraints().strip()
        parts = [p for p in (brand, assets) if p]
        return ("\n".join(parts) + "\n") if parts else ""
    return _ISOLATED_TEAM_IDENTITY


def own_site_suffixes() -> tuple[str, ...]:
    """Domaines « à soi » (anti-homonyme CRM) — env ou défaut legacy."""
    import os

    raw = (os.getenv("KORYMB_OWN_SITE_SUFFIXES") or "").strip()
    if raw:
        parts = tuple(p.strip().lower().lstrip(".") for p in raw.split(",") if p.strip())
        if parts:
            return parts
    if is_legacy_elude_workspace():
        return ("eludein.art",)
    return ()


def workspace_sender_name(fallback: str = "Korymb") -> str:
    label = _workspace_label(current_workspace_id())
    return label or fallback


def mail_message_id_domain(fallback: str = "korymb.local") -> str:
    """Domaine Message-ID RFC — env, sinon hôte public, sinon générique (pas de marque fixe)."""
    import os
    from urllib.parse import urlparse

    raw = (os.getenv("KORYMB_MAIL_MESSAGE_ID_DOMAIN") or "").strip().lstrip("@")
    if raw:
        return raw
    public = (os.getenv("KORYMB_PUBLIC_URL") or "").strip()
    if public:
        host = (urlparse(public).hostname or "").strip().lower()
        if host and host not in ("localhost", "127.0.0.1"):
            return host
    return fallback


def fleet_status_payload() -> dict[str, Any]:
    """Remplace l'ancien get_fleet_status hardcodé Empire Élude."""
    wid = current_workspace_id()
    label = _workspace_label(wid) or "Workspace"
    if is_legacy_elude_workspace(wid):
        return {
            "workspace_id": wid,
            "label": label,
            "legacy_pack": "elude",
            "note": "Pack instance legacy — détails dans le contexte métier injecté.",
            "assets": ["fleur_damours", "sivana", "vibrae", "ti_spoun"],
        }
    return {
        "workspace_id": wid,
        "label": label,
        "legacy_pack": None,
        "note": "Identité = mémoire partagée + vitrine workspace. Pas d'actifs Empire hardcodés.",
        "assets": [],
    }


# Alias historique (imports existants) — toujours dynamiques.
def FLEUR_CONTEXT_dynamic() -> str:  # noqa: N802
    return build_workspace_brand_context()
