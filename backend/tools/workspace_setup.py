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
        "korymb_list_projects",
        "korymb_create_project",
        "korymb_update_project",
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
    "S'il demande de **modifier** un projet, une tâche, une étape ou une carte "
    "(titre, description, statut, ajout, renommage, fait, retrait) : "
    "`korymb_list_projects` puis `korymb_update_project` dans ce tour. "
    "Un playbook ou un template existant se corrige avec `korymb_save_*` et son id. "
    "Interdit de dire que tu n'as pas d'outil d'édition, ou de renvoyer le dirigeant "
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
    {
        "name": "korymb_list_projects",
        "description": (
            "Liste les projets du workspace avec leurs tâches (titre, fait ou non, carte mission). "
            "À appeler avant de modifier un projet dont tu n'as pas l'id."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "korymb_update_project",
        "description": (
            "Modifie un projet Korymb déjà créé, et ses tâches / cartes « à faire ». "
            "Retrouve-le par project_id ou par title (titre actuel). "
            "new_title renomme le dossier. description, status et project_type mettent à jour la fiche. "
            "add_tasks ajoute des cartes. complete_tasks coche une tâche et sort la carte « à faire ». "
            "reopen_tasks la rouvre. remove_tasks retire une tâche pas encore lancée. "
            "rename_tasks et update_tasks corrigent le titre ou le détail. "
            "N'utilise pas cet outil pour un contact, un devis, un e-mail ou un post."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Id du projet si connu"},
                "title": {"type": "string", "description": "Titre actuel, pour retrouver le projet"},
                "new_title": {"type": "string", "description": "Nouveau titre, seulement en cas de renommage"},
                "description": {"type": "string"},
                "status": {
                    "type": "string",
                    "description": "active | on_hold | draft | completed | cancelled",
                },
                "project_type": {
                    "type": "string",
                    "description": "seance | stage | module_pro | accompagnement | sivana | autre",
                },
                "add_tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "detail": {"type": "string"},
                        },
                        "required": ["title"],
                    },
                },
                "complete_tasks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Titres de tâches à marquer faites",
                },
                "reopen_tasks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Titres de tâches à rouvrir",
                },
                "remove_tasks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Titres de tâches à retirer",
                },
                "rename_tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "new_title": {"type": "string"},
                        },
                        "required": ["title", "new_title"],
                    },
                },
                "update_tasks": {
                    "type": "array",
                    "description": "Nouveau détail d'une tâche existante",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "detail": {"type": "string"},
                        },
                        "required": ["title", "detail"],
                    },
                },
            },
            "required": [],
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


def _with_project_context(mission: str, description: str) -> str:
    """Remplace le bloc « Contexte du projet » collé dans une mission, sans toucher la consigne."""
    marker = "\n\nContexte du projet :\n"
    text = mission or ""
    if marker in text:
        head = text.split(marker, 1)[0].rstrip()
    elif text.startswith("Contexte du projet :\n"):
        head = ""
    else:
        return text
    desc = (description or "").strip()
    if not head:
        return f"Contexte du projet :\n{desc}"[:8000] if desc else ""
    if not desc:
        return head[:8000]
    return f"{head}{marker}{desc}"[:8000]


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


_STATUS_ALIASES = {
    "active": "active",
    "actif": "active",
    "en cours": "active",
    "on_hold": "on_hold",
    "pause": "on_hold",
    "en pause": "on_hold",
    "draft": "draft",
    "brouillon": "draft",
    "completed": "completed",
    "termine": "completed",
    "fait": "completed",
    "cloture": "completed",
    "cancelled": "cancelled",
    "annule": "cancelled",
}


def _name_list(raw: Any) -> list[str]:
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
    out: list[str] = []
    for item in raw:
        title = ""
        if isinstance(item, str):
            title = item.strip()
        elif isinstance(item, dict):
            title = str(item.get("title") or item.get("label") or "").strip()
        if title:
            out.append(title[:180])
        if len(out) >= 12:
            break
    return out


def _project_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    tasks = []
    for milestone in row.get("milestones") or []:
        if not isinstance(milestone, dict):
            continue
        tasks.append(
            {
                "title": str(milestone.get("label") or ""),
                "done": bool(milestone.get("done")),
                "job_id": str(milestone.get("job_id") or ""),
            }
        )
    pid = str(row.get("id") or "")
    return {
        "id": pid,
        "title": row.get("title"),
        "status": row.get("status"),
        "project_type": row.get("project_type"),
        "description": str(row.get("description") or "")[:500],
        "href": f"/gestion/projets/{pid}",
        "tasks": tasks,
    }


def _resolve_project(inp: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    from services.business_db import get_project, list_projects

    pid = str(inp.get("project_id") or "").strip()
    if pid:
        row = get_project(pid)
        if not row:
            return None, f"Projet introuvable : {pid}"
        return row, None
    title = str(inp.get("title") or "").strip()
    if not title:
        return None, "project_id ou title est requis."
    wanted = _fold_title(title)
    rows = list_projects(limit=200)
    exact = [r for r in rows if _fold_title(str(r.get("title") or "")) == wanted]
    hits = exact or [r for r in rows if wanted in _fold_title(str(r.get("title") or ""))]
    if len(hits) == 1:
        return hits[0], None
    if not hits:
        return None, f"Aucun projet ne correspond à « {title} »."
    names = ", ".join(f"{r.get('title')} ({r.get('id')})" for r in hits[:6])
    return None, f"Plusieurs projets correspondent. Précise project_id : {names}"


def _milestone_index(milestones: list[dict[str, Any]], title: str) -> int:
    wanted = _fold_title(title)
    for idx, milestone in enumerate(milestones):
        if _fold_title(str(milestone.get("label") or "")) == wanted:
            return idx
    return -1


def _append_planned_tasks(
    *,
    project_id: str,
    project_title: str,
    description: str,
    milestones: list[dict[str, Any]],
    linked: list[str],
    tasks: list[dict[str, str]],
) -> list[dict[str, str]]:
    from database import insert_planned_job

    made: list[dict[str, str]] = []
    for task in tasks:
        jid = uuid.uuid4().hex[:8]
        insert_planned_job(
            jid,
            "coordinateur",
            _planned_mission_text(
                project_title=project_title,
                task_title=task["title"],
                detail=task["detail"],
                description=description,
            ),
            source="project",
            mission_config={"mode": "cio", "project_id": project_id, "origin": "chat"},
        )
        milestones.append({"label": task["title"], "done": False, "job_id": jid})
        linked.append(jid)
        made.append({"job_id": jid, "title": task["title"], "href": f"/missions?job={jid}"})
    return made


def run_list_projects() -> str:
    from services.business_db import list_projects

    rows = [_project_snapshot(row) for row in list_projects(limit=40)]
    return _json({"ok": True, "href": "/gestion/projets", "projects": rows})


def run_update_project(inp: dict[str, Any]) -> str:
    from database import delete_job_cascade, get_job, set_job_status_quick, update_job_mission_text
    from services.business_db import PROJECT_STATUSES, PROJECT_TYPES, get_project, update_project

    project, err = _resolve_project(inp)
    if err or not project:
        return _json({"ok": False, "error": err or "Projet introuvable."})
    pid = str(project.get("id") or "")
    milestones = [dict(m) for m in (project.get("milestones") or []) if isinstance(m, dict)]
    linked = [str(x) for x in (project.get("linked_job_ids") or []) if str(x).strip()]
    title = str(project.get("title") or "")
    description = str(project.get("description") or "")
    notes: list[str] = []
    fields: dict[str, Any] = {}

    new_title = str(inp.get("new_title") or "").strip()[:200]
    if new_title and _fold_title(new_title) != _fold_title(title):
        fields["title"] = new_title
        for milestone in milestones:
            jid = str(milestone.get("job_id") or "")
            job = get_job(jid) if jid else None
            if job and str(job.get("status") or "") == "planned":
                mission = str(job.get("mission") or "")
                first, sep, rest = mission.partition("\n")
                prefix = f" — {title}"
                if first.endswith(prefix):
                    first = first[: -len(prefix)] + f" — {new_title}"
                    update_job_mission_text(jid, first + (sep + rest if sep else ""))
        title = new_title
        notes.append("titre")

    if "description" in inp:
        description = str(inp.get("description") or "").strip()[:8000]
        fields["description"] = description
        notes.append("description")
        for milestone in milestones:
            jid = str(milestone.get("job_id") or "")
            job = get_job(jid) if jid else None
            if not job:
                continue
            mission = str(job.get("mission") or "")
            rewritten = _with_project_context(mission, description)
            if rewritten != mission:
                update_job_mission_text(jid, rewritten)
        notes.append("contexte des tâches")

    if inp.get("status"):
        status = _STATUS_ALIASES.get(_fold_title(str(inp.get("status") or "")), "")
        if status not in PROJECT_STATUSES:
            return _json({"ok": False, "error": "status invalide.", "project": _project_snapshot(project)})
        fields["status"] = status
        notes.append("statut")

    if inp.get("project_type"):
        kind = str(inp.get("project_type") or "").strip().lower()
        if kind not in PROJECT_TYPES:
            return _json({"ok": False, "error": "project_type invalide.", "project": _project_snapshot(project)})
        fields["project_type"] = kind
        notes.append("type")

    added = _append_planned_tasks(
        project_id=pid,
        project_title=title,
        description=description,
        milestones=milestones,
        linked=linked,
        tasks=[
            task
            for task in _parse_tasks(inp.get("add_tasks"))
            if _milestone_index(milestones, task["title"]) < 0
        ],
    )
    if added:
        notes.append(f"{len(added)} tâche(s) ajoutée(s)")

    for old_name in _name_list(inp.get("complete_tasks")):
        idx = _milestone_index(milestones, old_name)
        if idx < 0:
            notes.append(f"introuvable : {old_name}")
            continue
        milestones[idx]["done"] = True
        jid = str(milestones[idx].get("job_id") or "")
        job = get_job(jid) if jid else None
        if job and str(job.get("status") or "") == "planned":
            set_job_status_quick(jid, "completed")
        notes.append(f"faite : {milestones[idx].get('label')}")

    for old_name in _name_list(inp.get("reopen_tasks")):
        idx = _milestone_index(milestones, old_name)
        if idx < 0:
            notes.append(f"introuvable : {old_name}")
            continue
        milestones[idx]["done"] = False
        jid = str(milestones[idx].get("job_id") or "")
        job = get_job(jid) if jid else None
        if job and str(job.get("status") or "") == "completed" and str(job.get("source") or "") == "project":
            set_job_status_quick(jid, "planned")
        notes.append(f"rouverte : {milestones[idx].get('label')}")

    rename_raw = inp.get("rename_tasks") or []
    if isinstance(rename_raw, str):
        try:
            rename_raw = json.loads(rename_raw)
        except json.JSONDecodeError:
            rename_raw = []
    for item in rename_raw if isinstance(rename_raw, list) else []:
        if not isinstance(item, dict):
            continue
        old_name = str(item.get("title") or "").strip()
        renamed = str(item.get("new_title") or "").strip()[:180]
        idx = _milestone_index(milestones, old_name)
        if idx < 0 or not renamed:
            notes.append(f"introuvable : {old_name or renamed}")
            continue
        milestones[idx]["label"] = renamed
        jid = str(milestones[idx].get("job_id") or "")
        job = get_job(jid) if jid else None
        if job and str(job.get("status") or "") == "planned":
            mission = str(job.get("mission") or "")
            _first, sep, rest = mission.partition("\n")
            update_job_mission_text(jid, f"{renamed} — {title}" + (sep + rest if sep else ""))
        notes.append(f"renommée : {renamed}")

    for task in _parse_tasks(inp.get("update_tasks")):
        idx = _milestone_index(milestones, task["title"])
        if idx < 0:
            notes.append(f"introuvable : {task['title']}")
            continue
        jid = str(milestones[idx].get("job_id") or "")
        job = get_job(jid) if jid else None
        if job and str(job.get("status") or "") == "planned":
            update_job_mission_text(
                jid,
                _planned_mission_text(
                    project_title=title,
                    task_title=str(milestones[idx].get("label") or task["title"]),
                    detail=task["detail"],
                    description=description,
                ),
            )
            notes.append(f"détail : {milestones[idx].get('label')}")
        else:
            notes.append(f"détail non réécrit (tâche déjà lancée) : {task['title']}")

    for old_name in _name_list(inp.get("remove_tasks")):
        idx = _milestone_index(milestones, old_name)
        if idx < 0:
            notes.append(f"introuvable : {old_name}")
            continue
        jid = str(milestones[idx].pop("job_id", "") or "")
        label = str(milestones[idx].get("label") or old_name)
        milestones.pop(idx)
        linked = [x for x in linked if x != jid]
        job = get_job(jid) if jid else None
        if job and str(job.get("status") or "") == "planned":
            delete_job_cascade(jid)
            notes.append(f"retirée : {label}")
        else:
            notes.append(f"retirée du projet, mission conservée : {label}")

    fields["milestones"] = milestones
    fields["linked_job_ids"] = linked
    updated = update_project(pid, **fields) or get_project(pid) or project
    return _json(
        {
            "ok": True,
            "project": _project_snapshot(updated),
            "added_tasks": added,
            "notes": notes,
            "href": f"/gestion/projets/{pid}",
            "missions_href": "/missions?view=kanban",
            "message": "Projet mis à jour." if notes else "Aucune modification demandée.",
        }
    )


def dispatch_workspace_tool(name: str, inp: dict[str, Any]) -> str | None:
    handlers: dict[str, Callable[[], str]] = {
        "korymb_list_mission_templates": run_list_mission_templates,
        "korymb_save_mission_template": lambda: run_save_mission_template(inp),
        "korymb_list_playbooks": run_list_playbooks,
        "korymb_save_playbook": lambda: run_save_playbook(inp),
        "korymb_list_projects": run_list_projects,
        "korymb_create_project": lambda: run_create_project(inp),
        "korymb_update_project": lambda: run_update_project(inp),
    }
    fn = handlers.get(name)
    if fn is None:
        return None
    return fn()
