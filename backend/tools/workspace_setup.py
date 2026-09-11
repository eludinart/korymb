"""Écriture native Korymb : templates de mission et playbooks (pas un copier-coller Drive)."""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Callable

_VAR_RE = re.compile(r"\{\{(\w+)\}\}")
_PLAYBOOK_CATS = frozenset({"fleur", "sivana", "generic", "ops", "studio"})

WORKSPACE_TAG_TO_TOOLS: dict[str, tuple[str, ...]] = {
    "workspace": (
        "korymb_list_mission_templates",
        "korymb_save_mission_template",
        "korymb_list_playbooks",
        "korymb_save_playbook",
    ),
}

WORKSPACE_SETUP_CONTEXT = (
    "\n\n### Dispositifs de travail Korymb (écriture réelle)\n"
    "Tu peux **créer** des templates de mission et des playbooks dans l'app "
    "(`korymb_save_mission_template`, `korymb_save_playbook`).\n"
    "Si le dirigeant demande de mettre en place, enregistrer, installer un dispositif "
    "(prompts stratégiques, fiches SWOT, communication, process) : "
    "liste d'abord l'existant, puis **écris** les fiches. "
    "Interdit de dire que tu ne peux pas créer d'environnement, "
    "ou de te limiter à un markdown à copier dans Drive.\n"
    "Après écriture, cite les noms et oriente vers `/administration/templates` "
    "et `/gestion/playbooks`. "
    "Une équipe d'agents reste une proposition (`propose_team_blueprint`) à valider dans le chat. "
    "CRM, e-mails et posts restent en file Décisions.\n"
)

WORKSPACE_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "korymb_list_mission_templates",
        "description": (
            "Liste les templates de mission du workspace (Administration → Templates). "
            "À appeler avant d'en créer pour éviter les doublons."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "korymb_save_mission_template",
        "description": (
            "Crée ou met à jour un template de mission réutilisable dans Korymb. "
            "Le texte peut contenir des placeholders {{variable}}. "
            "Le dirigeant le relance depuis Administration → Templates missions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nom court visible dans l'UI"},
                "description": {"type": "string", "description": "À quoi sert ce template"},
                "mission_text": {
                    "type": "string",
                    "description": "Consigne complète, avec {{placeholders}} si besoin",
                },
                "agent": {
                    "type": "string",
                    "description": "Agent qui exécute (défaut coordinateur / CIO)",
                },
                "template_id": {
                    "type": "string",
                    "description": "Id existant pour mettre à jour ; sinon création",
                },
            },
            "required": ["name", "mission_text"],
        },
    },
    {
        "name": "korymb_list_playbooks",
        "description": "Liste les playbooks du workspace (Gestion → Playbooks).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "korymb_save_playbook",
        "description": (
            "Crée ou met à jour un playbook (mission récurrente, bouton Lancer). "
            "Visible dans Gestion → Playbooks."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "mission": {"type": "string", "description": "Consigne exécutée au lancement"},
                "category": {
                    "type": "string",
                    "description": "ops, generic ou studio (défaut ops)",
                },
                "playbook_id": {"type": "string", "description": "Id existant pour mise à jour"},
                "agent": {"type": "string", "description": "Agent par défaut (coordinateur)"},
            },
            "required": ["name", "mission"],
        },
    },
]


def _json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def _extract_variables(mission_text: str) -> list[str]:
    return list(dict.fromkeys(_VAR_RE.findall(mission_text or "")))


def run_list_mission_templates() -> str:
    from database import list_mission_templates

    rows = list_mission_templates()
    return _json(
        {
            "ok": True,
            "href": "/administration/templates",
            "templates": [
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "description": r.get("description"),
                    "agent": r.get("agent"),
                    "variables": r.get("variables") or [],
                }
                for r in rows
            ],
        }
    )


def run_save_mission_template(inp: dict[str, Any]) -> str:
    from database import get_mission_template, upsert_mission_template

    name = str(inp.get("name") or "").strip()[:200]
    mission = str(inp.get("mission_text") or "").strip()[:20_000]
    if not name or not mission:
        return _json({"ok": False, "error": "name et mission_text sont requis."})
    tid = str(inp.get("template_id") or "").strip()[:32]
    if tid:
        if not get_mission_template(tid):
            return _json({"ok": False, "error": f"Template introuvable : {tid}"})
    else:
        tid = f"tpl-{uuid.uuid4().hex[:10]}"
    agent = str(inp.get("agent") or "coordinateur").strip()[:100] or "coordinateur"
    row = upsert_mission_template(
        tid,
        name=name,
        description=str(inp.get("description") or "").strip()[:1000],
        agent=agent,
        mission_text=mission,
        variables=_extract_variables(mission),
        config={"mode": "cio"},
    )
    return _json(
        {
            "ok": True,
            "created": True,
            "id": row.get("id") if row else tid,
            "name": name,
            "href": "/administration/templates",
            "variables": (row or {}).get("variables") or _extract_variables(mission),
        }
    )


def run_list_playbooks() -> str:
    from database import list_playbooks

    rows = list_playbooks()
    return _json(
        {
            "ok": True,
            "href": "/gestion/playbooks",
            "playbooks": [
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "description": r.get("description"),
                    "category": r.get("category"),
                }
                for r in rows
            ],
        }
    )


def run_save_playbook(inp: dict[str, Any]) -> str:
    from database import get_playbook, upsert_playbook

    name = str(inp.get("name") or "").strip()[:200]
    mission = str(inp.get("mission") or "").strip()[:20_000]
    if not name or not mission:
        return _json({"ok": False, "error": "name et mission sont requis."})
    pid = str(inp.get("playbook_id") or "").strip()[:32]
    if pid:
        if not get_playbook(pid):
            return _json({"ok": False, "error": f"Playbook introuvable : {pid}"})
    else:
        pid = f"pb-{uuid.uuid4().hex[:10]}"
    cat = str(inp.get("category") or "ops").strip().lower()
    if cat not in _PLAYBOOK_CATS:
        cat = "ops"
    agent = str(inp.get("agent") or "coordinateur").strip()[:100] or "coordinateur"
    row = upsert_playbook(
        pid,
        name=name,
        description=str(inp.get("description") or "").strip()[:2000],
        category=cat,
        steps={"mission": mission, "agent": agent, "agents": [agent]},
    )
    return _json(
        {
            "ok": True,
            "created": True,
            "id": (row or {}).get("id") or pid,
            "name": name,
            "href": "/gestion/playbooks",
        }
    )


def dispatch_workspace_tool(name: str, inp: dict[str, Any]) -> str | None:
    handlers: dict[str, Callable[[], str]] = {
        "korymb_list_mission_templates": run_list_mission_templates,
        "korymb_save_mission_template": lambda: run_save_mission_template(inp),
        "korymb_list_playbooks": run_list_playbooks,
        "korymb_save_playbook": lambda: run_save_playbook(inp),
    }
    fn = handlers.get(name)
    if fn is None:
        return None
    return fn()
