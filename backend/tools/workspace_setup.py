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
        "korymb_create_project",
    ),
}

WORKSPACE_SETUP_CONTEXT = (
    "\n\n### Dispositifs de travail Korymb (écriture réelle)\n"
    "Tu peux **créer** des templates de mission et des playbooks dans l'app "
    "(`korymb_save_mission_template`, `korymb_save_playbook`).\n"
    "Si le dirigeant demande de **créer un projet**, des tâches ou des cartes "
    "à partir de la conversation : appelle `korymb_create_project` dans ce tour. "
    "Ça écrit le dossier Gestion, les étapes, et une mission « à faire » par tâche "
    "(Missions, kanban, carte, briefing). "
    "Interdit de dire que tu n'as pas l'outil, ou de renvoyer le dirigeant "
    "cliquer Projets → +.\n"
    "Si le dirigeant demande de mettre en place, enregistrer, installer un dispositif "
    "(prompts stratégiques, fiches SWOT, communication, process) : "
    "liste d'abord l'existant, puis **écris** les fiches. "
    "Interdit de dire que tu ne peux pas créer d'environnement, "
    "ou de te limiter à un markdown à copier dans Drive.\n"
    "Après écriture, cite les noms et les pages (`/gestion/projets`, `/missions`, "
    "`/administration/templates`, `/gestion/playbooks`). "
    "Ne lance pas les agents : les tâches restent « à faire » jusqu'au bouton Lancer. "
    "Une équipe d'agents reste une proposition (`propose_team_blueprint`) à valider dans le chat. "
    "Fiches contact, devis, e-mails et posts restent en file Décisions.\n"
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
    {
        "name": "korymb_create_project",
        "description": (
            "Crée vraiment un projet Korymb à partir de la conversation : dossier dans Gestion → Projets, "
            "une étape par tâche, et une carte mission « à faire » par tâche (Missions, kanban, carte, briefing). "
            "N'appelle pas cet outil pour un simple template ou playbook. "
            "Ne lance pas les agents : le dirigeant clique Lancer quand il veut exécuter une tâche. "
            "Si un projet du même titre existe déjà, les nouvelles tâches y sont ajoutées."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Titre du projet, tel que le dirigeant le nomme"},
                "description": {
                    "type": "string",
                    "description": "Synthèse utile de la discussion (objectif, contraintes, hors-périmètre)",
                },
                "project_type": {
                    "type": "string",
                    "description": "seance | stage | module_pro | accompagnement | sivana | autre (défaut autre)",
                },
                "tasks": {
                    "type": "array",
                    "description": "Tâches à faire. Chaque élément : titre, et détail optionnel.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "detail": {"type": "string"},
                        },
                        "required": ["title"],
                    },
                },
            },
            "required": ["title"],
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


def _fold_title(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).casefold()


def _parse_tasks(raw: Any) -> list[dict[str, str]]:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            raw = [ln.strip(" -\t") for ln in text.splitlines() if ln.strip()]
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        title = ""
        detail = ""
        if isinstance(item, str):
            title = item.strip()
        elif isinstance(item, dict):
            title = str(item.get("title") or item.get("label") or "").strip()
            detail = str(item.get("detail") or item.get("description") or "").strip()
        if not title:
            continue
        key = _fold_title(title)
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title[:180], "detail": detail[:2000]})
        if len(out) >= 12:
            break
    return out


def _find_project_by_title(title: str) -> dict[str, Any] | None:
    from services.business_db import list_projects

    wanted = _fold_title(title)
    if not wanted:
        return None
    for row in list_projects(limit=200):
        if str(row.get("status") or "") in {"completed", "cancelled"}:
            continue
        if _fold_title(str(row.get("title") or "")) == wanted:
            return row
    return None


def _planned_mission_text(*, project_title: str, task_title: str, detail: str, description: str) -> str:
    lines = [f"{task_title} — {project_title}"]
    if detail.strip():
        lines.extend(["", detail.strip()])
    if description.strip():
        lines.extend(["", "Contexte du projet :", description.strip()])
    return "\n".join(lines)[:8000]


def run_create_project(inp: dict[str, Any]) -> str:
    from services.business_db import PROJECT_TYPES, create_project, update_project

    title = str(inp.get("title") or "").strip()[:200]
    if not title:
        return _json({"ok": False, "error": "title est requis."})
    description = str(inp.get("description") or "").strip()[:8000]
    project_type = str(inp.get("project_type") or "autre").strip().lower() or "autre"
    if project_type not in PROJECT_TYPES:
        project_type = "autre"
    tasks = _parse_tasks(inp.get("tasks"))
    if not tasks:
        tasks = [{"title": title, "detail": description[:2000]}]

    existing = _find_project_by_title(title)
    known = {
        _fold_title(str(m.get("label") or m.get("title") or ""))
        for m in (existing.get("milestones") if existing else []) or []
        if isinstance(m, dict)
    }
    fresh = [t for t in tasks if _fold_title(t["title"]) not in known]
    if existing and not fresh:
        pid = str(existing.get("id") or "")
        return _json(
            {
                "ok": True,
                "created": False,
                "reused": True,
                "id": pid,
                "title": existing.get("title") or title,
                "href": f"/gestion/projets/{pid}",
                "missions_href": "/missions?view=kanban",
                "tasks": [],
                "message": "Ce projet existe déjà, avec ces tâches.",
            }
        )

    if existing:
        project = existing
        created = False
        milestones = [m for m in (existing.get("milestones") or []) if isinstance(m, dict)]
        linked = [str(x) for x in (existing.get("linked_job_ids") or []) if str(x).strip()]
        if description and not str(existing.get("description") or "").strip():
            update_project(str(existing["id"]), description=description)
    else:
        project = create_project(
            title=title,
            description=description,
            project_type=project_type,
            status="active",
            milestones=[],
            linked_job_ids=[],
        )
        created = True
        milestones = []
        linked = []

    pid = str(project.get("id") or "")
    from database import insert_planned_job

    made: list[dict[str, str]] = []
    for task in fresh:
        jid = uuid.uuid4().hex[:8]
        mission = _planned_mission_text(
            project_title=title,
            task_title=task["title"],
            detail=task["detail"],
            description=description or str(project.get("description") or ""),
        )
        insert_planned_job(
            jid,
            "coordinateur",
            mission,
            source="project",
            mission_config={"mode": "cio", "project_id": pid, "origin": "chat"},
        )
        milestones.append({"label": task["title"], "done": False, "job_id": jid})
        linked.append(jid)
        made.append({"job_id": jid, "title": task["title"], "href": f"/missions?job={jid}"})

    update_project(pid, milestones=milestones, linked_job_ids=linked, status="active")
    return _json(
        {
            "ok": True,
            "created": created,
            "reused": not created,
            "id": pid,
            "title": title,
            "href": f"/gestion/projets/{pid}",
            "missions_href": "/missions?view=kanban",
            "tasks": made,
            "message": (
                "Projet créé. Les tâches sont dans Missions, colonne À faire. "
                "Elles ne démarrent pas toutes seules : le dirigeant clique Lancer."
                if created
                else "Tâches ajoutées au projet existant. Elles sont à faire, pas lancées."
            ),
        }
    )


def dispatch_workspace_tool(name: str, inp: dict[str, Any]) -> str | None:
    handlers: dict[str, Callable[[], str]] = {
        "korymb_list_mission_templates": run_list_mission_templates,
        "korymb_save_mission_template": lambda: run_save_mission_template(inp),
        "korymb_list_playbooks": run_list_playbooks,
        "korymb_save_playbook": lambda: run_save_playbook(inp),
        "korymb_create_project": lambda: run_create_project(inp),
    }
    fn = handlers.get(name)
    if fn is None:
        return None
    return fn()
