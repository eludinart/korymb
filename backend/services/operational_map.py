"""Carte opérationnelle : équipes, missions, projets CRM, agents, graphe de connaissance."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timedelta
from typing import Any

from state import parse_team_field

_ACTIVE_JOB = frozenset({"running", "pending", "awaiting_validation", "paused"})
_WAITING_JOB = frozenset({"awaiting_validation", "paused"})
_DONE_JOB = frozenset({"completed", "validated", "closed", "cancelled"})

_REL_FR = {
    "owns": "possède",
    "manages": "pilote",
    "created_by": "créé par",
    "distributed_through": "distribué via",
    "owned_by": "appartenant à",
    "supports": "soutient",
    "connected_to": "relié à",
    "member": "membre",
    "leads": "chef d'équipe",
    "runs": "mission",
    "works_on": "travaille sur",
    "linked": "mission liée",
    "contact": "contact",
    "related": "lié",
}


def _fold(text: str) -> str:
    raw = unicodedata.normalize("NFKD", (text or "").lower())
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", raw).strip()


def _clip(text: str, n: int = 80) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) <= n:
        return t
    return t[: n - 1] + "…"


def _nid(kind: str, raw: str) -> str:
    return f"{kind}:{raw}"


def _job_urgency(status: str, *, hitl: bool) -> str:
    st = (status or "").strip().lower()
    if st.startswith("error") or st == "failed":
        return "blocked"
    if hitl or st in _WAITING_JOB:
        return "waiting"
    if st in _ACTIVE_JOB:
        return "active"
    if st in _DONE_JOB:
        return "done"
    return "idle"


_HITL_FR = {
    "cio_plan": "plan d'équipe à valider",
    "cio_question": "question en attente",
}


def _job_where(status: str, *, hitl: bool, hitl_kind: str) -> str:
    st = (status or "").strip().lower()
    if hitl:
        return f"En attente de vous ({_HITL_FR.get(hitl_kind, hitl_kind or 'validation')})"
    if st == "running":
        return "Mission en cours"
    if st == "paused":
        return "En pause"
    if st == "pending":
        return "En file"
    if st.startswith("error"):
        return "Bloquée (erreur)"
    if st in _DONE_JOB:
        return "Terminée"
    return status or "—"


def _job_next(status: str, *, hitl: bool, hitl_kind: str) -> str:
    if hitl:
        if hitl_kind == "cio_plan":
            return "Valider le plan dans Décisions"
        if hitl_kind == "cio_question":
            return "Répondre dans Décisions"
        return "Décider dans Décisions"
    st = (status or "").strip().lower()
    if st in _ACTIVE_JOB:
        return "Suivre l'exécution"
    if st.startswith("error"):
        return "Voir l'échec et relancer, ou supprimer"
    if st in _DONE_JOB:
        return "Clôturer ou archiver"
    return ""


def _plain_excerpt(text: str, n: int = 200) -> str:
    t = re.sub(r"```[\s\S]*?```", " ", text or "")
    t = re.sub(r"[#*_`>]+", " ", t)
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return _clip(t, n)


def _mission_detail(job: dict[str, Any], *, hitl: bool, hitl_kind: str, where: str) -> str:
    surface = _plain_excerpt(str(job.get("result_surface") or ""), 220)
    if surface:
        return surface
    result = _plain_excerpt(str(job.get("result") or ""), 220)
    if result:
        return result
    if hitl:
        return _job_next("", hitl=True, hitl_kind=hitl_kind) or where
    return where


def _next_milestone(milestones: list[Any]) -> str:
    for item in milestones or []:
        if not isinstance(item, dict):
            continue
        if item.get("done"):
            continue
        label = str(item.get("label") or "").strip()
        if label:
            return label
    return ""


def _team_people(team: list[Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in team or []:
        if isinstance(row, str):
            key = row.strip()
            label = key
            status = ""
        elif isinstance(row, dict):
            key = str(row.get("key") or row.get("agent") or "").strip()
            label = str(row.get("label") or key).strip() or key
            status = str(row.get("status") or "").strip()
        else:
            continue
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({"key": key, "label": label, "status": status})
    return out


def _parse_json_obj(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw or "{}")
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _parse_json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    try:
        data = json.loads(raw or "[]")
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _load_jobs(limit: int = 80) -> list[dict[str, Any]]:
    from database import get_conn, _ws

    lim = max(1, min(int(limit), 120))
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, agent, mission, status, source, created_at, updated_at, parent_job_id, "
            "user_validated_at, team_trace, mission_config_json, hitl_gate_json, "
            "SUBSTR(COALESCE(result_surface, ''), 1, 400) AS result_surface, "
            "SUBSTR(COALESCE(result, ''), 1, 800) AS result "
            "FROM jobs WHERE workspace_id=? ORDER BY updated_at DESC LIMIT ?",
            (_ws(), lim),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows or []:
        d = dict(row)
        d["job_id"] = str(d.pop("id", "") or "")
        d["team"] = parse_team_field({"team_trace": d.pop("team_trace", "[]")})
        d["mission_config"] = _parse_json_obj(d.pop("mission_config_json", "{}"))
        d["hitl_gate"] = _parse_json_obj(d.pop("hitl_gate_json", "{}"))
        out.append(d)
    return out


def build_operational_map() -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    edge_seen: set[tuple[str, str, str]] = set()

    def add_node(node: dict[str, Any]) -> str:
        nid = str(node["id"])
        prev = nodes.get(nid)
        if prev:
            if not prev.get("subtitle") and node.get("subtitle"):
                prev["subtitle"] = node["subtitle"]
            if node.get("urgency") == "active":
                prev["urgency"] = "active"
            return nid
        nodes[nid] = node
        return nid

    def add_edge(source: str, target: str, kind: str, label: str = "") -> None:
        if not source or not target or source == target:
            return
        if source not in nodes or target not in nodes:
            return
        key = (source, target, kind)
        if key in edge_seen:
            return
        edge_seen.add(key)
        edges.append(
            {
                "id": f"{kind}:{source}->{target}",
                "source": source,
                "target": target,
                "kind": kind,
                "label": label or _REL_FR.get(kind, kind),
            }
        )

    groups: list[dict[str, Any]] = []
    enterprise_id = "entreprise"
    try:
        from services.agent_groups import ENTERPRISE_GROUP_ID, list_groups

        enterprise_id = ENTERPRISE_GROUP_ID
        groups = [g for g in list_groups(include_archived=False) if g.get("status") != "archived"]
    except Exception:
        groups = []

    for g in groups:
        gid = str(g.get("id") or "").strip()
        if not gid:
            continue
        is_ent = gid == enterprise_id
        add_node(
            {
                "id": _nid("team", gid),
                "kind": "team",
                "label": str(g.get("label") or gid),
                "subtitle": "Flotte entreprise" if is_ent else "Équipe projet",
                "status": str(g.get("status") or "active"),
                "urgency": "idle",
                "href": f"/gestion/equipes" if is_ent else f"/missions?team={gid}",
                "where": "Contexte de travail prêt",
                "next": "Lancer une mission avec cette équipe",
                "who": [str(m.get("label") or m.get("key") or "") for m in (g.get("members") or [])][:8],
                "meta": {"group_id": gid, "system": bool(g.get("is_system"))},
            }
        )
        lead = str(g.get("lead_agent_key") or "").strip()
        lead_label = str(g.get("lead_label") or lead)
        members = list(g.get("members") or [])
        if lead and not any(str(m.get("key")) == lead for m in members):
            members = [{"key": lead, "label": lead_label, "role": "lead"}] + members
        for m in members:
            key = str(m.get("key") or "").strip()
            if not key:
                continue
            label = str(m.get("label") or key)
            aid = add_node(
                {
                    "id": _nid("agent", key),
                    "kind": "agent",
                    "label": label,
                    "subtitle": str(m.get("role") or key),
                    "status": "idle",
                    "urgency": "idle",
                    "href": f"/dashboard?agent={key}",
                    "where": "Disponible",
                    "next": "",
                    "who": [label],
                    "meta": {"agent_key": key},
                }
            )
            add_edge(_nid("team", gid), aid, "member" if key != lead else "leads")

    jobs = []
    try:
        jobs = _load_jobs(80)
    except Exception:
        jobs = []

    for job in jobs:
        source = str(job.get("source") or "mission")
        if source == "chat":
            continue
        jid = str(job.get("job_id") or "").strip()
        if not jid:
            continue
        cfg = job.get("mission_config") if isinstance(job.get("mission_config"), dict) else {}
        gid = str(cfg.get("agent_group_id") or "").strip() or enterprise_id
        status = str(job.get("status") or "")
        gate = job.get("hitl_gate") if isinstance(job.get("hitl_gate"), dict) else {}
        hitl_kind = str(gate.get("kind") or (gate.get("gate") or {}).get("kind") or "").strip()
        hitl = status == "awaiting_validation" or bool(hitl_kind)
        people = _team_people(job.get("team") or [])
        who_labels = [p["label"] for p in people] or [str(job.get("agent") or "CIO")]
        title = _clip(str(job.get("mission") or f"Mission {jid}"), 88)
        where = _job_where(status, hitl=hitl, hitl_kind=hitl_kind)
        next_step = _job_next(status, hitl=hitl, hitl_kind=hitl_kind)
        href = f"/inbox?job={jid}" if hitl else f"/missions?job={jid}"
        cta_label = "Décider" if hitl else "Ouvrir"
        if hitl and hitl_kind == "cio_plan":
            cta_label = "Valider le plan"
        mid = add_node(
            {
                "id": _nid("mission", jid),
                "kind": "mission",
                "label": title or f"Mission {jid}",
                "subtitle": status,
                "status": status,
                "urgency": _job_urgency(status, hitl=hitl),
                "href": href,
                "where": where,
                "next": next_step,
                "detail": _mission_detail(job, hitl=hitl, hitl_kind=hitl_kind, where=where),
                "who": who_labels,
                "cta": {"label": cta_label, "href": href},
                "updated_at": job.get("updated_at") or job.get("created_at"),
                "meta": {
                    "job_id": jid,
                    "group_id": gid,
                    "hitl": hitl,
                    "hitl_kind": hitl_kind,
                    "updated_at": job.get("updated_at") or job.get("created_at"),
                },
            }
        )
        team_id = _nid("team", gid)
        if team_id not in nodes:
            add_node(
                {
                    "id": team_id,
                    "kind": "team",
                    "label": gid,
                    "subtitle": "Équipe",
                    "status": "active",
                    "urgency": "idle",
                    "href": f"/missions?team={gid}",
                    "where": "",
                    "next": "",
                    "who": [],
                    "meta": {"group_id": gid},
                }
            )
        add_edge(team_id, mid, "runs")
        if status in _ACTIVE_JOB and team_id in nodes:
            nodes[team_id]["urgency"] = "active"
            nodes[team_id]["where"] = "Des missions tournent ici"
        for p in people:
            aid = _nid("agent", p["key"])
            if aid not in nodes:
                add_node(
                    {
                        "id": aid,
                        "kind": "agent",
                        "label": p["label"],
                        "subtitle": p["key"],
                        "status": p["status"] or "idle",
                        "urgency": "active" if status in _ACTIVE_JOB else "idle",
                        "href": f"/dashboard?agent={p['key']}",
                        "where": "Sur une mission" if status in _ACTIVE_JOB else "Vu sur une mission",
                        "next": "",
                        "who": [p["label"]],
                        "meta": {"agent_key": p["key"]},
                    }
                )
            add_edge(aid, mid, "works_on")
            if status in _ACTIVE_JOB:
                nodes[aid]["urgency"] = "active"
                nodes[aid]["where"] = f"En cours · {title}"
                nodes[aid]["status"] = "working"

    projects: list[dict[str, Any]] = []
    contacts_by_id: dict[str, dict[str, Any]] = {}
    try:
        from services.business_db import list_contacts, list_projects

        projects = list_projects(limit=200)
        for c in list_contacts(limit=400):
            cid = str(c.get("id") or "")
            if cid:
                contacts_by_id[cid] = c
    except Exception:
        projects = []

    events_by_project: dict[str, list[dict[str, Any]]] = {}
    try:
        from services.business_db import list_calendar_events

        soon = (datetime.utcnow() - timedelta(days=1)).isoformat()
        later = (datetime.utcnow() + timedelta(days=45)).isoformat()
        for ev in list_calendar_events(from_at=soon, to_at=later, limit=200):
            pid = str(ev.get("project_id") or "").strip()
            if not pid:
                continue
            events_by_project.setdefault(pid, []).append(ev)
    except Exception:
        events_by_project = {}

    for prj in projects:
        pid = str(prj.get("id") or "").strip()
        if not pid:
            continue
        st = str(prj.get("status") or "draft")
        if st == "archived":
            continue
        miles = prj.get("milestones") if isinstance(prj.get("milestones"), list) else []
        nxt = _next_milestone(miles)
        upcoming = events_by_project.get(pid) or []
        upcoming.sort(key=lambda e: str(e.get("starts_at") or ""))
        next_ev = ""
        if upcoming:
            ev0 = upcoming[0]
            next_ev = _clip(str(ev0.get("title") or "Séance"), 60)
        cid = str(prj.get("contact_id") or "").strip()
        contact = contacts_by_id.get(cid) if cid else None
        who = [str(contact.get("name") or "")] if contact else []
        urgency = "active" if st == "active" else ("done" if st in {"done", "completed"} else "idle")
        where = {
            "active": "Projet en cours",
            "draft": "Brouillon",
            "done": "Clôturé",
            "paused": "En pause",
        }.get(st, st)
        going = nxt or (f"Prochaine séance : {next_ev}" if next_ev else "Aucun jalon défini")
        prid = add_node(
            {
                "id": _nid("project", pid),
                "kind": "project",
                "label": str(prj.get("title") or "Projet"),
                "subtitle": str(prj.get("project_type") or ""),
                "status": st,
                "urgency": urgency,
                "href": f"/gestion/projets/{pid}",
                "where": where,
                "next": going,
                "detail": _clip(str(prj.get("notes") or prj.get("description") or going), 200),
                "who": who,
                "cta": {"label": "Ouvrir le dossier", "href": f"/gestion/projets/{pid}"},
                "updated_at": prj.get("updated_at") or prj.get("created_at"),
                "meta": {
                    "project_id": pid,
                    "contact_id": cid,
                    "linked_job_ids": prj.get("linked_job_ids") or [],
                },
            }
        )
        if contact:
            cnode = add_node(
                {
                    "id": _nid("contact", cid),
                    "kind": "contact",
                    "label": str(contact.get("name") or cid),
                    "subtitle": str(contact.get("company") or contact.get("contact_type") or ""),
                    "status": str(contact.get("status") or ""),
                    "urgency": "idle",
                    "href": f"/gestion/contacts/{cid}",
                    "where": "Contact du projet",
                    "next": "",
                    "who": [str(contact.get("name") or "")],
                    "meta": {"contact_id": cid},
                }
            )
            add_edge(prid, cnode, "contact")
        for jid in prj.get("linked_job_ids") or []:
            jid_s = str(jid or "").strip()
            if not jid_s:
                continue
            mid = _nid("mission", jid_s)
            if mid in nodes:
                add_edge(prid, mid, "linked")

    entities: list[dict[str, Any]] = []
    try:
        from services.knowledge import list_entities

        entities = list_entities()
    except Exception:
        entities = []

    name_to_id: dict[str, str] = {}
    for ent in entities:
        name = str(ent.get("name") or "").strip()
        if not name:
            continue
        eid_raw = str(ent.get("entity_id") or _fold(name) or name)
        attrs = ent.get("attributes") if isinstance(ent.get("attributes"), dict) else {}
        etype = str(ent.get("entity_type") or "project")
        summary = str(attrs.get("type") or attrs.get("role") or attrs.get("posture") or etype)
        kid = add_node(
            {
                "id": _nid("knowledge", eid_raw),
                "kind": "knowledge",
                "label": name,
                "subtitle": etype,
                "status": "knowledge",
                "urgency": "idle",
                "href": "",
                "where": _clip(summary, 140) or "Entité du graphe de connaissance",
                "next": "",
                "who": [],
                "meta": {"entity_id": eid_raw, "entity_type": etype},
            }
        )
        name_to_id[_fold(name)] = kid

    for ent in entities:
        name = str(ent.get("name") or "").strip()
        src = name_to_id.get(_fold(name))
        if not src:
            continue
        rels = ent.get("relations") if isinstance(ent.get("relations"), dict) else {}
        for rel, targets in rels.items():
            names = targets if isinstance(targets, list) else [targets]
            for tgt in names:
                tid = name_to_id.get(_fold(str(tgt or "")))
                if tid:
                    add_edge(src, tid, str(rel or "related")[:32], _REL_FR.get(str(rel), str(rel)))

    # Rapprochements souples nom ↔ équipe / projet CRM
    for node in list(nodes.values()):
        if node["kind"] not in {"team", "project"}:
            continue
        folded = _fold(str(node.get("label") or ""))
        if len(folded) < 4:
            continue
        for kn, kid in name_to_id.items():
            if len(kn) < 4:
                continue
            if kn in folded or folded in kn:
                add_edge(node["id"], kid, "related")

    stats = {
        "teams": sum(1 for n in nodes.values() if n["kind"] == "team"),
        "missions": sum(1 for n in nodes.values() if n["kind"] == "mission"),
        "active": sum(1 for n in nodes.values() if n.get("urgency") == "active"),
        "waiting": sum(1 for n in nodes.values() if n.get("urgency") == "waiting"),
        "projects": sum(1 for n in nodes.values() if n["kind"] == "project"),
        "agents": sum(1 for n in nodes.values() if n["kind"] == "agent"),
        "knowledge": sum(1 for n in nodes.values() if n["kind"] == "knowledge"),
    }
    return {
        "nodes": list(nodes.values()),
        "edges": edges,
        "stats": stats,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
