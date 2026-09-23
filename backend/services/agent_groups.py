"""
Groupes d'agents + blueprints d'équipe (Assistant).

- Groupe système « entreprise » : CIO + flotte métier (non supprimable).
- Groupes custom : créés via blueprint validé (Assistant) ou admin.
- Blueprint : proposition versionnée → confirm → agents customs + groupe actif.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any

from database import (
    ALLOWED_AGENT_TOOL_TAGS,
    delete_custom_agent,
    list_custom_agent_keys_raw,
    upsert_custom_agent,
    validate_custom_agent_key,
)
from services.agents import (
    BUILTIN_AGENT_DEFINITIONS,
    agents_def,
    refresh_agents_definitions_cache,
)

ENTERPRISE_GROUP_ID = "entreprise"
MAX_AGENTS_PER_GROUP = 6
SAFE_DEFAULT_TOOLS = ("web", "drive", "knowledge", "studio")


class GroupInUseError(ValueError):
    """Suppression refusée : missions, cadrages ou propositions encore liés."""

    def __init__(self, preview: dict[str, Any]):
        self.preview = preview
        super().__init__(str(preview.get("summary") or "flotte encore utilisée"))

GROUP_TEMPLATES: dict[str, dict[str, Any]] = {
    "edition": {
        "key": "edition",
        "label": "Édition / livre",
        "description": "Écrire un ouvrage ou un cycle éditorial (plan, rédaction, relecture).",
        "lead": {
            "key": "editeur_en_chef",
            "label": "Éditeur en chef",
            "role": "Pilotage éditorial",
            "tools": ["web", "drive", "knowledge", "studio"],
            "system": (
                "Tu es l'éditeur en chef. Tu structures le projet éditorial, décomposes en chapitres / livrables, "
                "délègues rédaction et relecture, et synthétises pour le dirigeant. Pas de prospection CRM ni posts sociaux "
                "sauf demande explicite."
            ),
        },
        "members": [
            {
                "key": "narrateur",
                "label": "Narrateur",
                "role": "Rédaction",
                "tools": ["web", "drive", "studio"],
                "system": "Tu rédiges prose claire, ton adapté à la charte du workspace, blocs LIVRABLE complets.",
            },
            {
                "key": "documentaliste",
                "label": "Documentaliste",
                "role": "Recherche & sources",
                "tools": ["web", "drive", "knowledge"],
                "system": "Tu recherches et structures sources, glossaires, références — sans inventer de citations.",
            },
            {
                "key": "relecteur",
                "label": "Relecteur",
                "role": "Style & cohérence",
                "tools": ["drive", "studio"],
                "system": "Tu relis pour clarté, ton, cohérence ; tu proposes des corrections concrètes.",
            },
        ],
        "out_of_scope": ["prospection commerciale", "publication réseaux sociaux", "facturation"],
    },
    "terrain": {
        "key": "terrain",
        "label": "Terrain / Sïvana",
        "description": "Projets ancrés terrain (écolieu, stages, logistique réelle).",
        "lead": {
            "key": "chef_projet_terrain",
            "label": "Chef de projet terrain",
            "role": "Coordination terrain",
            "tools": ["web", "drive", "knowledge", "gestion"],
            "system": (
                "Tu coordonnes des projets exécutables sur le terrain (Sïvana, stages). "
                "Tu refuses les plans déconnectés de la capacité réelle."
            ),
        },
        "members": [
            {
                "key": "logisticien",
                "label": "Logisticien",
                "role": "Organisation pratique",
                "tools": ["web", "drive", "gestion"],
                "system": "Tu détaille planning, matériel, contraintes terrain.",
            },
            {
                "key": "mediateur",
                "label": "Médiateur",
                "role": "Accueil & relation",
                "tools": ["web", "drive", "gestion"],
                "system": "Tu prépares accueil participants, consignes, communication douce.",
            },
        ],
        "out_of_scope": ["dev logiciel", "campagne Meta"],
    },
    "rd_tech": {
        "key": "rd_tech",
        "label": "R&D technique",
        "description": "Évolutions produit Korymb / apps — specs, pas git direct.",
        "lead": {
            "key": "architecte_produit",
            "label": "Architecte produit",
            "role": "Specs & arbitrage",
            "tools": ["web", "knowledge", "validate", "db"],
            "system": (
                "Tu cadres les évolutions produit. Tu utilises propose_platform_change pour les specs. "
                "Pas de commit git."
            ),
        },
        "members": [
            {
                "key": "analyste_ux",
                "label": "Analyste UX",
                "role": "Parcours dirigeant",
                "tools": ["web", "knowledge"],
                "system": "Tu analyses parcours UI et formules critères d'acceptation clairs.",
            },
            {
                "key": "qa_spec",
                "label": "QA / critères",
                "role": "Tests & risques",
                "tools": ["knowledge", "validate"],
                "system": "Tu listes risques, cas de test et non-régressions.",
            },
        ],
        "out_of_scope": ["envoi e-mail prospect", "posts Instagram"],
    },
}


def _now() -> str:
    return datetime.utcnow().isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _parse_json_list(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if isinstance(data, list):
            return [str(x).strip() for x in data if str(x).strip()]
    return []


def _parse_json_obj(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if isinstance(data, dict):
            return data
    return {}


def default_group_policy() -> dict[str, Any]:
    return {
        "max_agents": MAX_AGENTS_PER_GROUP,
        "allowed_tool_tags": list(SAFE_DEFAULT_TOOLS),
        "hitl_strict": True,
        "memory_scope": "group",  # group | enterprise | none
        "forbid_external_send": True,
    }


def ensure_enterprise_group() -> dict[str, Any]:
    """Crée / répare le groupe système entreprise."""
    from database import get_agent_group, upsert_agent_group

    existing = get_agent_group(ENTERPRISE_GROUP_ID)
    members = ["commercial", "community_manager", "developpeur", "comptable"]
    if existing:
        # Réinjecte les builtins manquants sans écraser customs déjà membres
        cur = _parse_json_list(existing.get("member_keys"))
        merged = list(dict.fromkeys([*members, *[k for k in cur if k not in members and k != "coordinateur"]]))
        if merged != cur or existing.get("status") != "active":
            return upsert_agent_group(
                ENTERPRISE_GROUP_ID,
                slug="entreprise",
                label=existing.get("label") or "Entreprise",
                description=existing.get("description")
                or "Flotte métier par défaut — commercial, CM, dev, comptable.",
                status="active",
                lead_agent_key="coordinateur",
                member_keys=merged,
                policy=_parse_json_obj(existing.get("policy")) or default_group_policy()
                | {"memory_scope": "enterprise", "forbid_external_send": False, "allowed_tool_tags": sorted(ALLOWED_AGENT_TOOL_TAGS)},
                is_system=True,
                template_key=None,
            )
        return existing
    return upsert_agent_group(
        ENTERPRISE_GROUP_ID,
        slug="entreprise",
        label="Entreprise",
        description="Flotte métier par défaut — commercial, CM, dev, comptable.",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=members,
        policy={
            **default_group_policy(),
            "memory_scope": "enterprise",
            "forbid_external_send": False,
            "max_agents": 12,
            "allowed_tool_tags": sorted(ALLOWED_AGENT_TOOL_TAGS),
        },
        is_system=True,
        template_key=None,
    )


def list_group_templates() -> list[dict[str, Any]]:
    return [
        {
            "key": t["key"],
            "label": t["label"],
            "description": t["description"],
            "member_count": 1 + len(t.get("members") or []),
            "out_of_scope": t.get("out_of_scope") or [],
        }
        for t in GROUP_TEMPLATES.values()
    ]


def serialize_group(row: dict[str, Any]) -> dict[str, Any]:
    members = _parse_json_list(row.get("member_keys"))
    lead = str(row.get("lead_agent_key") or "").strip()
    ad = agents_def()
    member_details = []
    for k in members:
        cfg = ad.get(k) or {}
        member_details.append(
            {
                "key": k,
                "label": cfg.get("label") or k,
                "role": cfg.get("role") or "",
                "tools": list(cfg.get("tools") or []),
                "builtin": k in BUILTIN_AGENT_DEFINITIONS,
            }
        )
    lead_cfg = ad.get(lead) or {}
    policy = _parse_json_obj(row.get("policy")) or default_group_policy()
    gid = str(row.get("id") or "")
    scope = str(policy.get("memory_scope") or "group").strip().lower()
    if scope not in ("enterprise", "group", "none"):
        scope = "group"
    inherit_shared = False
    try:
        from database import get_agent_group_memory

        inherit_shared = bool(get_agent_group_memory(gid).get("inherit_shared"))
    except Exception:
        inherit_shared = False
    if gid == ENTERPRISE_GROUP_ID or scope == "enterprise":
        sees_identity = True
    elif scope == "none":
        sees_identity = False
    else:
        sees_identity = inherit_shared
    return {
        "id": row.get("id"),
        "slug": row.get("slug"),
        "label": row.get("label"),
        "description": row.get("description") or "",
        "status": row.get("status") or "active",
        "lead_agent_key": lead,
        "lead_label": lead_cfg.get("label") or lead,
        "lead_role": lead_cfg.get("role") or "",
        "lead_tools": list(lead_cfg.get("tools") or []),
        "lead_builtin": lead in BUILTIN_AGENT_DEFINITIONS,
        "member_keys": members,
        "members": member_details,
        "policy": policy,
        "memory_scope": scope,
        "inherit_shared": inherit_shared,
        "sees_workspace_identity": sees_identity,
        "is_system": bool(int(row.get("is_system") or 0)),
        "template_key": row.get("template_key"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def list_groups(*, include_archived: bool = False) -> list[dict[str, Any]]:
    from database import list_agent_groups

    ensure_enterprise_group()
    rows = list_agent_groups(include_archived=include_archived)
    return [serialize_group(r) for r in rows]


def get_group(group_id: str) -> dict[str, Any] | None:
    from database import get_agent_group

    ensure_enterprise_group()
    row = get_agent_group((group_id or "").strip())
    return serialize_group(row) if row else None


def group_allowed_delegate_keys(group_id: str | None) -> tuple[str, ...] | None:
    """
    None = pas de filtre (comportement historique).
    Tuple = clés déléguables pour ce groupe (hors lead).
    """
    gid = (group_id or "").strip()
    if not gid:
        return None
    g = get_group(gid)
    if not g or g.get("status") == "archived":
        return tuple()
    lead = str(g.get("lead_agent_key") or "")
    keys = [k for k in (g.get("member_keys") or []) if k and k != lead]
    # Entreprise : inclure aussi les customs non rattachés à un autre groupe actif
    if gid == ENTERPRISE_GROUP_ID:
        claimed = set()
        for other in list_groups(include_archived=False):
            if other["id"] == ENTERPRISE_GROUP_ID:
                continue
            claimed.add(other.get("lead_agent_key") or "")
            claimed.update(other.get("member_keys") or [])
        for k, cfg in agents_def().items():
            if k in BUILTIN_AGENT_DEFINITIONS:
                continue
            if cfg.get("is_manager"):
                continue
            if k in claimed:
                continue
            if k not in keys:
                keys.append(k)
    return tuple(keys)


def group_orchestrator_key(group_id: str | None) -> str:
    if not group_id:
        return "coordinateur"
    g = get_group(group_id)
    if not g:
        return "coordinateur"
    lead = str(g.get("lead_agent_key") or "coordinateur").strip()
    return lead if lead in agents_def() else "coordinateur"


def chat_speaker_is_enterprise_cio(orchestrator_key: str | None, agent_group_id: str | None) -> bool:
    """Le CIO ne parle que pour la flotte Entreprise. Une équipe projet a son propre lead."""
    key = (orchestrator_key or "coordinateur").strip() or "coordinateur"
    gid = (agent_group_id or "").strip()
    return key == "coordinateur" and (not gid or gid == ENTERPRISE_GROUP_ID)


def chat_speaker_constraint(*, orchestrator_key: str, agent_group_id: str | None, label: str) -> str:
    """Consigne d'identité pour le chat : ne pas répondre « je suis le CIO » au nom d'une autre flotte."""
    if chat_speaker_is_enterprise_cio(orchestrator_key, agent_group_id):
        return (
            "Tu es le CIO : ne mobilise un sous-agent que si son livrable est indispensable. "
            "Par défaut, assume seul."
        )
    who = (label or orchestrator_key or "lead").strip()
    return (
        f"Tu es {who}, lead de l'équipe sélectionnée. "
        "Tu n'es pas le CIO, pas le DSI, pas l'orchestrateur de la flotte Entreprise. "
        "Si l'on te demande qui tu es, nomme ce rôle et cette équipe, jamais le CIO. "
        "Ne mobilise un membre que si son livrable est indispensable. Par défaut, assume seul."
    )


def chat_speaker_persona(agent_cfg: dict, *, orchestrator_key: str, agent_group_id: str | None) -> str:
    """Prompt de rôle du locuteur. Une équipe projet ne reprend pas le manifeste du CIO."""
    label = str((agent_cfg or {}).get("label") or orchestrator_key or "lead")
    raw = str((agent_cfg or {}).get("system") or "").strip()
    if chat_speaker_is_enterprise_cio(orchestrator_key, agent_group_id):
        return raw
    if re.search(r"\bcio\b|chief information officer|orchestrateur strat[eé]gique", raw, re.I):
        raw = ""
    return f"Tu es {label}. Tu parles au nom de ton équipe, pas au nom du CIO.\n{raw}".strip()


def _slugify(label: str) -> str:
    s = (label or "").strip().lower()
    s = unicodedata_fold(s)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return (s[:40] or "groupe")[:40]


def unicodedata_fold(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c))


def build_dry_run_summary(blueprint: dict[str, Any]) -> str:
    lead = blueprint.get("lead") or {}
    members = blueprint.get("members") or []
    lines = [
        f"**Équipe proposée :** {blueprint.get('label') or 'Sans titre'}",
        f"**Chef :** {lead.get('label') or lead.get('key') or '—'}",
        f"**Membres ({len(members)}) :** "
        + (", ".join(str(m.get("label") or m.get("key")) for m in members) or "aucun"),
    ]
    oos = blueprint.get("out_of_scope") or []
    if oos:
        lines.append("**Hors périmètre :** " + ", ".join(str(x) for x in oos[:8]))
    sim = blueprint.get("simulation") or ""
    if sim:
        lines.append(f"**Simulation :** {sim}")
    risks = blueprint.get("risks") or []
    if risks:
        lines.append("**Risques :** " + "; ".join(str(x) for x in risks[:5]))
    n = 1 + len(members)
    if n > MAX_AGENTS_PER_GROUP:
        lines.append(f"⚠️ Trop d'agents ({n} > {MAX_AGENTS_PER_GROUP}) — à réduire avant création.")
    return "\n".join(lines)


def normalize_blueprint_payload(raw: dict[str, Any], *, intent: str = "") -> dict[str, Any]:
    label = str(raw.get("label") or raw.get("title") or "Équipe projet").strip()[:120]
    lead_in = raw.get("lead") if isinstance(raw.get("lead"), dict) else {}
    members_in = raw.get("members") if isinstance(raw.get("members"), list) else []

    def _norm_agent(a: dict[str, Any], *, fallback_prefix: str) -> dict[str, Any]:
        key_raw = str(a.get("key") or "").strip().lower().replace("-", "_")
        if not key_raw:
            key_raw = f"{fallback_prefix}_{uuid.uuid4().hex[:6]}"
        canon, err = validate_custom_agent_key(key_raw)
        if err:
            # Si collision avec builtin réservé, suffixer
            canon, err2 = validate_custom_agent_key(f"{key_raw}_x")
            if err2:
                canon = f"{fallback_prefix}_{uuid.uuid4().hex[:8]}"
        tools_raw = a.get("tools") if isinstance(a.get("tools"), list) else list(SAFE_DEFAULT_TOOLS)
        tools = [str(t).strip() for t in tools_raw if str(t).strip() in ALLOWED_AGENT_TOOL_TAGS]
        if not tools:
            tools = list(SAFE_DEFAULT_TOOLS)
        # Anti-usine : pas d'outils d'envoi externes par défaut sur équipes custom
        tools = [t for t in tools if t not in ("email", "instagram", "facebook", "social_auto", "whatsapp")]
        return {
            "key": canon,
            "label": str(a.get("label") or canon).strip()[:160],
            "role": str(a.get("role") or "").strip()[:400],
            "tools": tools,
            "system": str(a.get("system") or a.get("system_prompt") or "").strip()[:12000]
            or f"Tu es {a.get('label') or canon}. Tu livres des blocs LIVRABLE concrets.",
            "reuse_existing": bool(a.get("reuse_existing")),
        }

    lead = _norm_agent(lead_in or {"key": "chef_projet", "label": "Chef de projet"}, fallback_prefix="lead")
    members: list[dict[str, Any]] = []
    seen = {lead["key"]}
    for i, m in enumerate(members_in[: MAX_AGENTS_PER_GROUP - 1]):
        if not isinstance(m, dict):
            continue
        row = _norm_agent(m, fallback_prefix=f"agent{i}")
        if row["key"] in seen:
            row["key"] = f"{row['key']}_{i}"
        seen.add(row["key"])
        members.append(row)

    # Cap anti-usine
    members = members[: MAX_AGENTS_PER_GROUP - 1]

    out_of_scope = raw.get("out_of_scope") if isinstance(raw.get("out_of_scope"), list) else []
    out_of_scope = [str(x).strip() for x in out_of_scope if str(x).strip()][:12]

    return {
        "label": label,
        "intent": (intent or str(raw.get("intent") or "")).strip()[:4000],
        "lead": lead,
        "members": members,
        "out_of_scope": out_of_scope,
        "simulation": str(raw.get("simulation") or "").strip()[:2000],
        "risks": [str(x).strip() for x in (raw.get("risks") or []) if str(x).strip()][:8],
        "template_key": str(raw.get("template_key") or "").strip() or None,
        "policy": {
            **default_group_policy(),
            **(_parse_json_obj(raw.get("policy"))),
        },
    }


def propose_blueprint_from_template(template_key: str, *, intent: str = "") -> dict[str, Any]:
    tpl = GROUP_TEMPLATES.get((template_key or "").strip())
    if not tpl:
        raise ValueError(f"template inconnu : {template_key}")
    payload = normalize_blueprint_payload(
        {
            "label": tpl["label"],
            "intent": intent or tpl["description"],
            "lead": tpl["lead"],
            "members": tpl["members"],
            "out_of_scope": tpl.get("out_of_scope") or [],
            "template_key": tpl["key"],
            "simulation": (
                f"Avec cette équipe, le premier livrable serait cadré par {tpl['lead']['label']}, "
                f"puis délégué aux rôles spécialisés du template « {tpl['label']} »."
            ),
            "risks": ["Vérifier que les outils Drive/studio sont configurés si besoin de fichiers."],
        },
        intent=intent,
    )
    return create_blueprint_proposal(payload, chat_session_id=None)


def create_blueprint_proposal(
    payload: dict[str, Any],
    *,
    chat_session_id: str | None = None,
) -> dict[str, Any]:
    from database import insert_team_blueprint

    normalized = normalize_blueprint_payload(payload, intent=str(payload.get("intent") or ""))
    dry = build_dry_run_summary(normalized)
    bid = _new_id("bp")
    row = insert_team_blueprint(
        bid,
        status="proposed",
        title=normalized["label"],
        intent=normalized.get("intent") or "",
        dry_run_summary=dry,
        payload=normalized,
        chat_session_id=(chat_session_id or "")[:64] or None,
    )
    return serialize_blueprint(row)


def serialize_blueprint(row: dict[str, Any]) -> dict[str, Any]:
    payload = _parse_json_obj(row.get("payload"))
    return {
        "id": row.get("id"),
        "status": row.get("status"),
        "title": row.get("title"),
        "intent": row.get("intent") or "",
        "dry_run_summary": row.get("dry_run_summary") or "",
        "payload": payload,
        "group_id": row.get("group_id"),
        "chat_session_id": row.get("chat_session_id"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def get_blueprint(blueprint_id: str) -> dict[str, Any] | None:
    from database import get_team_blueprint

    row = get_team_blueprint((blueprint_id or "").strip())
    return serialize_blueprint(row) if row else None


def list_blueprints(*, limit: int = 30) -> list[dict[str, Any]]:
    from database import list_team_blueprints

    return [serialize_blueprint(r) for r in list_team_blueprints(limit=limit)]


def confirm_blueprint(blueprint_id: str) -> dict[str, Any]:
    """Crée customs + groupe actif à partir d'un blueprint proposé."""
    from database import get_team_blueprint, update_team_blueprint, upsert_agent_group

    row = get_team_blueprint((blueprint_id or "").strip())
    if not row:
        raise ValueError("blueprint introuvable")
    if row.get("status") == "confirmed" and row.get("group_id"):
        g = get_group(str(row["group_id"]))
        return {"ok": True, "already": True, "blueprint": serialize_blueprint(row), "group": g}

    payload = normalize_blueprint_payload(_parse_json_obj(row.get("payload")))
    n = 1 + len(payload.get("members") or [])
    if n > MAX_AGENTS_PER_GROUP:
        raise ValueError(f"équipe trop large ({n} > {MAX_AGENTS_PER_GROUP})")

    created_keys: list[str] = []
    try:
        for agent in [payload["lead"], *payload["members"]]:
            key = agent["key"]
            if key in agents_def() and agent.get("reuse_existing"):
                created_keys.append(key)
                continue
            if key in BUILTIN_AGENT_DEFINITIONS:
                raise ValueError(f"clé réservée builtin : {key}")
            upsert_custom_agent(
                key,
                label=agent["label"],
                role=agent["role"],
                system_prompt=agent["system"],
                tools=agent["tools"],
            )
            created_keys.append(key)
        refresh_agents_definitions_cache()

        slug = _slugify(payload["label"])
        gid = _new_id("grp")
        # Évite collision slug
        existing_slugs = {g.get("slug") for g in list_groups(include_archived=True)}
        base_slug = slug
        i = 2
        while slug in existing_slugs:
            slug = f"{base_slug}_{i}"
            i += 1

        lead_key = payload["lead"]["key"]
        member_keys = [m["key"] for m in payload["members"]]
        group_row = upsert_agent_group(
            gid,
            slug=slug,
            label=payload["label"],
            description=(payload.get("intent") or "")[:500],
            status="active",
            lead_agent_key=lead_key,
            member_keys=member_keys,
            policy=payload.get("policy") or default_group_policy(),
            is_system=False,
            template_key=payload.get("template_key"),
        )
        update_team_blueprint(
            blueprint_id,
            status="confirmed",
            group_id=gid,
            dry_run_summary=build_dry_run_summary(payload),
            payload=payload,
        )
        return {
            "ok": True,
            "already": False,
            "blueprint": get_blueprint(blueprint_id),
            "group": serialize_group(group_row),
            "created_agent_keys": created_keys,
        }
    except Exception:
        # Best-effort rollback des customs fraîchement créés (hors reuse)
        for k in created_keys:
            if k in BUILTIN_AGENT_DEFINITIONS:
                continue
            try:
                delete_custom_agent(k)
            except Exception:
                pass
        refresh_agents_definitions_cache()
        raise


def reject_blueprint(blueprint_id: str) -> dict[str, Any]:
    from database import get_team_blueprint, update_team_blueprint

    row = get_team_blueprint((blueprint_id or "").strip())
    if not row:
        raise ValueError("blueprint introuvable")
    update_team_blueprint(blueprint_id, status="rejected")
    return {"ok": True, "blueprint": get_blueprint(blueprint_id)}


def archive_group(group_id: str) -> dict[str, Any]:
    from database import get_agent_group, upsert_agent_group

    if (group_id or "").strip() == ENTERPRISE_GROUP_ID:
        raise ValueError("le groupe entreprise ne peut pas être archivé")
    row = get_agent_group(group_id)
    if not row:
        raise ValueError("groupe introuvable")
    updated = upsert_agent_group(
        str(row["id"]),
        slug=str(row["slug"]),
        label=str(row["label"]),
        description=str(row.get("description") or ""),
        status="archived",
        lead_agent_key=str(row["lead_agent_key"]),
        member_keys=_parse_json_list(row.get("member_keys")),
        policy=_parse_json_obj(row.get("policy")) or default_group_policy(),
        is_system=bool(int(row.get("is_system") or 0)),
        template_key=row.get("template_key"),
    )
    return serialize_group(updated)


def _live_job_refs_for_group(group_id: str) -> list[dict[str, Any]]:
    gid = (group_id or "").strip()
    if not gid:
        return []
    try:
        from state import active_jobs
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for jid, job in (active_jobs or {}).items():
        if not isinstance(job, dict):
            continue
        cfg = job.get("mission_config") if isinstance(job.get("mission_config"), dict) else {}
        if str(cfg.get("agent_group_id") or "").strip() != gid:
            continue
        out.append(
            {
                "id": str(jid),
                "status": str(job.get("status") or "running"),
                "mission": str(job.get("mission") or "")[:160],
                "agent": str(job.get("agent") or ""),
                "created_at": "",
            }
        )
    return out


def _exclusive_custom_agents(row: dict[str, Any]) -> list[dict[str, str]]:
    gid = str(row.get("id") or "").strip()
    keys = [str(row.get("lead_agent_key") or "").strip(), *_parse_json_list(row.get("member_keys"))]
    keys = [k for k in keys if k]
    used_elsewhere: set[str] = set()
    try:
        from database import list_agent_groups

        for other in list_agent_groups(include_archived=True):
            oid = str(other.get("id") or "")
            if oid == gid:
                continue
            used_elsewhere.add(str(other.get("lead_agent_key") or "").strip())
            used_elsewhere.update(_parse_json_list(other.get("member_keys")))
    except Exception:
        used_elsewhere = set()
    custom = set(list_custom_agent_keys_raw())
    ad = agents_def()
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for k in keys:
        if k in seen or k in BUILTIN_AGENT_DEFINITIONS or k in used_elsewhere or k not in custom:
            continue
        seen.add(k)
        cfg = ad.get(k) or {}
        out.append({"key": k, "label": str(cfg.get("label") or k)})
    return out


def _live_job_refs_for_agent(agent_key: str) -> list[dict[str, Any]]:
    key = (agent_key or "").strip()
    if not key:
        return []
    try:
        from state import active_jobs
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for jid, job in (active_jobs or {}).items():
        if not isinstance(job, dict):
            continue
        status = str(job.get("status") or "running").strip().lower()
        if status not in ("running", "pending", "awaiting_validation", "paused"):
            continue
        if str(job.get("agent") or "").strip() == key:
            hit = True
        else:
            team = job.get("team")
            hit = isinstance(team, list) and any(
                isinstance(row, dict) and str(row.get("key") or "").strip() == key for row in team
            )
        if not hit:
            continue
        out.append(
            {
                "id": str(jid),
                "status": status,
                "mission": str(job.get("mission") or "")[:160],
                "agent": str(job.get("agent") or ""),
            }
        )
    return out


def agent_delete_preview(agent_key: str) -> dict[str, Any]:
    """Suppression d'une fiche custom : refusée si flotte, mission active ou cadrage ouvert."""
    from database import list_active_job_refs_for_agent, list_open_session_refs_for_agent

    key = (agent_key or "").strip()
    ad = agents_def()
    cfg = ad.get(key)
    if not cfg:
        raise ValueError("agent introuvable")
    builtin = key in BUILTIN_AGENT_DEFINITIONS or bool(cfg.get("is_manager"))
    fleets: list[dict[str, str]] = []
    for group in list_groups(include_archived=False):
        lead = str(group.get("lead_agent_key") or "").strip()
        members = [str(k).strip() for k in (group.get("member_keys") or [])]
        if key != lead and key not in members:
            continue
        fleets.append(
            {
                "id": str(group.get("id") or ""),
                "label": str(group.get("label") or group.get("id") or ""),
                "role": "lead" if key == lead else "membre",
            }
        )
    jobs = list_active_job_refs_for_agent(key)
    seen = {j["id"] for j in jobs}
    for item in _live_job_refs_for_agent(key):
        if item["id"] not in seen:
            jobs.append(item)
            seen.add(item["id"])
    sessions = list_open_session_refs_for_agent(key)

    parts: list[str] = []
    if builtin:
        parts.append("agent intégré, non supprimable")
    if fleets:
        n = len(fleets)
        parts.append(f"rattaché à {n} flotte{'s' if n != 1 else ''}")
    if jobs:
        n = len(jobs)
        parts.append(f"{n} mission{'s' if n != 1 else ''} active{'s' if n != 1 else ''}")
    if sessions:
        n = len(sessions)
        parts.append(f"{n} cadrage{'s' if n != 1 else ''} ouvert{'s' if n != 1 else ''}")
    can_delete = not parts
    if can_delete:
        summary = "Aucune flotte ni activité en cours : l'agent peut être supprimé."
    else:
        summary = "Impossible de supprimer : " + ", ".join(parts) + "."
    return {
        "agent_key": key,
        "label": str(cfg.get("label") or key),
        "builtin": key in BUILTIN_AGENT_DEFINITIONS,
        "can_delete": can_delete,
        "summary": summary,
        "fleets": fleets,
        "jobs": jobs[:25],
        "jobs_count": len(jobs),
        "sessions": sessions[:25],
        "sessions_count": len(sessions),
    }


def group_delete_preview(group_id: str) -> dict[str, Any]:
    from database import (
        get_agent_group,
        list_blueprint_refs_for_group,
        list_job_refs_for_agent_group,
        list_mission_session_refs_for_group,
    )

    gid = (group_id or "").strip()
    row = get_agent_group(gid)
    if not row:
        raise ValueError("groupe introuvable")
    is_system = bool(int(row.get("is_system") or 0)) or gid == ENTERPRISE_GROUP_ID
    jobs = list_job_refs_for_agent_group(gid)
    live = _live_job_refs_for_group(gid)
    live_ids = {j["id"] for j in jobs}
    for item in live:
        if item["id"] not in live_ids:
            jobs.append(item)
            live_ids.add(item["id"])
    sessions = list_mission_session_refs_for_group(gid)
    blueprints = [
        b
        for b in list_blueprint_refs_for_group(gid)
        if str(b.get("status") or "") == "proposed"
    ]
    exclusive = [] if is_system else _exclusive_custom_agents(row)

    parts: list[str] = []
    if is_system:
        parts.append("la flotte Entreprise ne peut pas être supprimée")
    if jobs:
        n = len(jobs)
        parts.append(f"{n} mission{'s' if n != 1 else ''}")
    if sessions:
        n = len(sessions)
        parts.append(f"{n} cadrage{'s' if n != 1 else ''}")
    if blueprints:
        n = len(blueprints)
        parts.append(f"{n} proposition{'s' if n != 1 else ''} d'équipe en attente")

    can_delete = not is_system and not jobs and not sessions and not blueprints
    if can_delete:
        summary = "Aucun usage restant : la flotte peut être supprimée."
    elif is_system:
        summary = "La flotte Entreprise ne peut pas être supprimée."
    else:
        summary = "Impossible de supprimer : " + ", ".join(parts) + "."

    return {
        "group_id": gid,
        "label": str(row.get("label") or gid),
        "is_system": is_system,
        "can_delete": can_delete,
        "summary": summary,
        "jobs": jobs[:25],
        "jobs_count": len(jobs),
        "sessions": sessions[:25],
        "sessions_count": len(sessions),
        "blueprints": blueprints[:15],
        "exclusive_agents": exclusive,
    }


def delete_group(group_id: str) -> dict[str, Any]:
    from database import delete_agent_group_row, get_agent_group

    preview = group_delete_preview(group_id)
    if preview.get("is_system"):
        raise ValueError(preview["summary"])
    if not preview["can_delete"]:
        raise GroupInUseError(preview)
    row = get_agent_group(group_id)
    if not row:
        raise ValueError("groupe introuvable")
    deleted_agents: list[dict[str, str]] = []
    for agent in preview.get("exclusive_agents") or []:
        key = str(agent.get("key") or "").strip()
        if not key:
            continue
        try:
            if delete_custom_agent(key):
                deleted_agents.append({"key": key, "label": str(agent.get("label") or key)})
        except ValueError:
            continue
    refresh_agents_definitions_cache()
    if not delete_agent_group_row(str(row["id"])):
        raise ValueError("suppression impossible")
    refresh_agents_definitions_cache()
    return {
        "ok": True,
        "deleted_id": str(row["id"]),
        "deleted_agents": deleted_agents,
    }


def update_group_members(
    group_id: str,
    *,
    label: str | None = None,
    description: str | None = None,
    lead_agent_key: str | None = None,
    member_keys: list[str] | None = None,
    status: str | None = None,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from database import get_agent_group, upsert_agent_group

    row = get_agent_group(group_id)
    if not row:
        raise ValueError("groupe introuvable")
    if bool(int(row.get("is_system") or 0)) and status == "archived":
        raise ValueError("groupe système non archivable")
    lead = (lead_agent_key if lead_agent_key is not None else row["lead_agent_key"]).strip()
    members = member_keys if member_keys is not None else _parse_json_list(row.get("member_keys"))
    members = [k for k in members if k and k != lead]
    if len(members) + 1 > MAX_AGENTS_PER_GROUP and not bool(int(row.get("is_system") or 0)):
        raise ValueError(f"max {MAX_AGENTS_PER_GROUP} agents par groupe")
    ad = agents_def()
    if lead not in ad:
        raise ValueError(f"lead inconnu : {lead}")
    for k in members:
        if k not in ad:
            raise ValueError(f"membre inconnu : {k}")
    updated = upsert_agent_group(
        str(row["id"]),
        slug=str(row["slug"]),
        label=(label if label is not None else row["label"]),
        description=(description if description is not None else row.get("description") or ""),
        status=(status if status is not None else row.get("status") or "active"),
        lead_agent_key=lead,
        member_keys=members,
        policy=policy if policy is not None else (_parse_json_obj(row.get("policy")) or default_group_policy()),
        is_system=bool(int(row.get("is_system") or 0)),
        template_key=row.get("template_key"),
    )
    return serialize_group(updated)


def get_group_memory(group_id: str) -> dict[str, Any]:
    from database import get_agent_group_memory

    return get_agent_group_memory(group_id)


def set_group_memory(
    group_id: str,
    *,
    notes: str | None = None,
    inherit_shared: bool | None = None,
) -> dict[str, Any]:
    from database import get_agent_group, upsert_agent_group_memory

    gid = (group_id or "").strip()
    if not get_agent_group(gid):
        raise ValueError("groupe introuvable")
    return upsert_agent_group_memory(gid, notes=notes, inherit_shared=inherit_shared)


def group_memory_scope(group_id: str | None) -> str:
    """Retourne memory_scope du groupe : enterprise | group | none."""
    gid = (group_id or "").strip()
    if not gid:
        return "enterprise"
    g = get_group(gid)
    if not g:
        return "enterprise"
    policy = g.get("policy") if isinstance(g.get("policy"), dict) else {}
    scope = str(policy.get("memory_scope") or "group").strip().lower()
    if scope not in ("enterprise", "group", "none"):
        return "group"
    return scope


def format_group_memory_prompt(group_id: str, *, max_chars: int = 4000) -> str:
    """Bloc texte mémoire d'équipe (notes + option héritage global)."""
    from database import get_agent_group_memory, get_enterprise_memory

    gid = (group_id or "").strip()
    if not gid:
        return ""
    mem = get_agent_group_memory(gid)
    notes = str(mem.get("notes") or "").strip()
    parts: list[str] = []
    if notes:
        clipped = notes if len(notes) <= max_chars else notes[: max_chars - 1].rstrip() + "…"
        parts.append("--- Mémoire d'équipe (persistante) ---")
        parts.append(clipped)
        parts.append("--- Fin mémoire d'équipe ---")
    if mem.get("inherit_shared"):
        try:
            ent = get_enterprise_memory()
            contexts = ent.get("contexts") or {}
            global_txt = contexts.get("global") if isinstance(contexts, dict) else ""
            global_txt = global_txt.strip() if isinstance(global_txt, str) else ""
            if global_txt:
                gmax = min(1400, max_chars)
                clipped_g = global_txt if len(global_txt) <= gmax else global_txt[: gmax - 1].rstrip() + "…"
                parts.append("--- Mémoire partagée (héritée) ---")
                parts.append("Contexte global :\n" + clipped_g)
                parts.append("--- Fin mémoire partagée ---")
        except Exception:
            pass
    return "\n".join(parts)


ASSISTANT_SYSTEM = (
    "Tu es l'**Assistant Korymb** — copilote conversationnel par défaut du dirigeant.\n"
    "### Identité (non négociable)\n"
    "Si l'on te demande qui tu es : tu es l'**Assistant Korymb**, un chatbot généraliste dans le cockpit. "
    "Tu n'es **pas** le CIO / DSI / Orchestrateur (autre mode du sélecteur). "
    "Ne te présente jamais comme CIO.\n"
    "### Priorité n°1 — conversation ouverte\n"
    "Réponds à **toutes** les questions : idées, stratégie, technique, rédaction, brainstorm, explications, "
    "comparaisons, reformulations, exploration pas à pas. "
    "Comporte-toi comme un chatbot utile et curieux : questionne si besoin, propose des pistes, "
    "approfondis sans tout ramener aux « équipes d'agents ».\n"
    "N'évoque la création d'équipe / blueprints **que** si le dirigeant le demande, "
    "ou si un vrai projet multi-rôles se dessine clairement (livre, chantier terrain, R&D, etc.). "
    "Sur une simple question (« qui es-tu », « explique X », « que penses-tu de Y »), "
    "réponds directement — **sans** pitch d'équipe.\n"
    "### Capacités secondaires (sur demande)\n"
    "Quand c'est pertinent : clarifier une intention, structurer un plan, "
    "ou proposer une équipe via `propose_team_blueprint` / `propose_team_from_template`, "
    "puis inviter à valider « Créer l'équipe » dans l'UI.\n"
    "Si le besoin exige d'exécuter la flotte métier (prospection, posts, devis, envois), "
    "oriente vers le **CIO** ou le groupe Entreprise — sans bloquer la conversation.\n"
    "### Écriture dans Korymb (sur demande)\n"
    "Templates de mission et playbooks : tu les **créés vraiment** via "
    "`korymb_save_mission_template` / `korymb_save_playbook` "
    "(après `korymb_list_*` pour ne pas doublonner). "
    "Ne dis jamais que tu ne peux pas créer d'environnement, "
    "ni de te limiter à un fichier à coller dans Drive. "
    "Après coup : cite les noms et les pages `/administration/templates` et `/gestion/playbooks`. "
    "Une équipe reste à valider (« Créer l'équipe »).\n"
    "### Limites d'engagement\n"
    "Tu ne lances pas l'orchestration multi-agents, tu n'écris pas directement en CRM, "
    "tu n'envoies pas d'e-mails ni de posts (le dirigeant valide ailleurs).\n"
    "Anti-usine : si tu proposes une équipe, max 6 agents, un chef, hors-périmètre explicite.\n"
    "Réponds en français, clair, utile, naturel.\n"
)
