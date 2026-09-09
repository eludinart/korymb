"""
registry_business.py — Outils agents pour le module Gestion Korymb (CRM, devis, planning).
"""
from __future__ import annotations

import json
from typing import Any, Callable

from services.business_db import (
    INTERACTION_TYPES,
    append_contact_notes,
    create_calendar_event,
    create_enrichment_proposal,
    create_project,
    create_quote,
    get_business_overview,
    get_contact,
    get_quote,
    list_calendar_events,
    list_interactions,
    list_projects,
    list_quotes,
    log_interaction,
    search_contacts,
    update_contact,
    update_quote,
    upsert_contact,
)
from services.tiime_client import request_tiime_invoice

GESTION_TAG_TO_TOOLS: dict[str, tuple[str, ...]] = {
    "gestion": (
        "gestion_overview",
        "gestion_search_contacts",
        "gestion_upsert_contact",
        "gestion_update_contact",
        "gestion_propose_contact_enrichment",
        "gestion_log_interaction",
        "gestion_list_interactions",
        "gestion_create_project",
        "gestion_list_projects",
        "gestion_create_quote",
        "gestion_list_quotes",
        "gestion_schedule_event",
        "gestion_list_events",
        "gestion_request_tiime_invoice",
    ),
}

GESTION_EXECUTE_GATED: frozenset[str] = frozenset({
    "gestion_request_tiime_invoice",
})

BUSINESS_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "gestion_overview",
        "description": (
            "Statistiques du cockpit Gestion Korymb : contacts actifs, projets, devis en cours, "
            "événements à venir, factures Tiime non payées."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "gestion_search_contacts",
        "description": (
            "Recherche dans le CRM Korymb (contacts / prospects / clients) par nom, email, "
            "entreprise, tags ou notes. Toujours chercher avant de créer un doublon."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Termes de recherche"},
                "limit": {"type": "integer", "description": "Max résultats (défaut 15)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "gestion_upsert_contact",
        "description": (
            "Crée ou enrichit un contact dans Korymb Gestion. Intègre TOUTES les données trouvées "
            "(profil LinkedIn, site, spécialité, ville, angle commercial) dans notes et tags. "
            "Déduplication par email si présent."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "company": {"type": "string"},
                "contact_type": {
                    "type": "string",
                    "description": "prospect | client | partenaire | autre",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Ex: coach, thérapeute, Var, Fleur d'ÅmÔurs",
                },
                "profile_notes": {
                    "type": "string",
                    "description": "Infos factuelles : sources, URL, spécialité, contexte (pas l'angle de vente)",
                },
                "outreach_suggestions": {
                    "type": "string",
                    "description": "Comment approcher / contacter ce prospect (accroche, offre, canal)",
                },
                "agent_key": {"type": "string"},
                "job_id": {"type": "string"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "gestion_update_contact",
        "description": "Met à jour un contact existant (statut client, tags, notes additionnelles).",
        "input_schema": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "contact_type": {"type": "string"},
                "status": {"type": "string"},
                "append_notes": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["contact_id"],
        },
    },
    {
        "name": "gestion_propose_contact_enrichment",
        "description": (
            "Propose un enrichissement de fiche contact (email, tél, site, LinkedIn, adresse, réseaux) "
            "SANS écrire directement. Le dirigeant valide un diff avant application. "
            "À utiliser pour les explorations détaillées CRM."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string", "description": "ID exact de la fiche Korymb"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "website": {"type": "string"},
                "linkedin_url": {"type": "string"},
                "address": {"type": "string"},
                "city": {"type": "string"},
                "postal_code": {"type": "string"},
                "company": {"type": "string"},
                "instagram": {"type": "string"},
                "facebook": {"type": "string"},
                "youtube": {"type": "string"},
                "resalib": {"type": "string"},
                "notes_append": {
                    "type": "string",
                    "description": (
                        "Infos FACTUELLES uniquement (spécialité, SIRET, contexte métier, sources). "
                        "Ne pas y mettre l'angle de vente ni comment contacter."
                    ),
                },
                "outreach_suggestions": {
                    "type": "string",
                    "description": (
                        "Suggestions d'APPROCHE commerciale : canal, accroche, offre, timing, "
                        "prochaine action — en approfondissant ce qui a déjà été suggéré/fait."
                    ),
                },
                "sources": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "URLs / sources utilisées",
                },
                "summary": {"type": "string", "description": "Résumé court pour le dirigeant"},
                "agent_key": {"type": "string"},
                "job_id": {"type": "string"},
            },
            "required": ["contact_id"],
        },
    },
    {
        "name": "gestion_log_interaction",
        "description": (
            "Journalise une interaction commerciale (prospection, email, appel, RDV, note) "
            "liée à un contact Korymb — historique visible dans l'application."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "project_id": {"type": "string"},
                "quote_id": {"type": "string"},
                "interaction_type": {
                    "type": "string",
                    "description": "prospection | email | call | meeting | note | quote | mission | other",
                },
                "summary": {"type": "string", "description": "Titre court"},
                "details": {"type": "string", "description": "Corps / contexte complet"},
                "agent_key": {"type": "string"},
                "job_id": {"type": "string"},
            },
            "required": ["contact_id", "summary"],
        },
    },
    {
        "name": "gestion_list_interactions",
        "description": "Historique des interactions pour un contact ou projet.",
        "input_schema": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "project_id": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": [],
        },
    },
    {
        "name": "gestion_create_project",
        "description": (
            "Ouvre un projet commercial (séance, stage SÏvåñà, module pro, accompagnement) "
            "rattaché à un contact."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "contact_id": {"type": "string"},
                "project_type": {
                    "type": "string",
                    "description": "seance | stage | module_pro | accompagnement | sivana | autre",
                },
                "description": {"type": "string"},
                "location": {"type": "string"},
                "status": {"type": "string"},
                "linked_job_id": {"type": "string", "description": "ID mission Korymb associée"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "gestion_list_projects",
        "description": "Liste les projets Gestion (filtre contact ou statut).",
        "input_schema": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "status": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": [],
        },
    },
    {
        "name": "gestion_create_quote",
        "description": (
            "Crée un devis structuré dans Korymb (numérotation DEV-AAAA-NNNN). "
            "lines_json : tableau JSON [{\"label\",\"qty\",\"unit_price_cents\",\"tax_rate\"}]. "
            "Prix en centimes EUR. Facture légale ensuite via Tiime."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "contact_id": {"type": "string"},
                "project_id": {"type": "string"},
                "lines_json": {"type": "string", "description": "JSON array des lignes"},
                "notes": {"type": "string"},
                "status": {"type": "string", "description": "draft | sent"},
                "agent_key": {"type": "string"},
                "job_id": {"type": "string"},
            },
            "required": ["title", "lines_json"],
        },
    },
    {
        "name": "gestion_list_quotes",
        "description": "Liste les devis Korymb (filtre contact ou statut).",
        "input_schema": {
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "status": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": [],
        },
    },
    {
        "name": "gestion_schedule_event",
        "description": "Planifie séance, stage ou atelier dans le planning métier Korymb.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "starts_at": {"type": "string", "description": "ISO 8601"},
                "ends_at": {"type": "string"},
                "contact_id": {"type": "string"},
                "project_id": {"type": "string"},
                "event_type": {"type": "string"},
                "location": {"type": "string"},
                "notes": {"type": "string"},
            },
            "required": ["title", "starts_at"],
        },
    },
    {
        "name": "gestion_list_events",
        "description": "Liste les créneaux planning Korymb (fenêtre optionnelle ISO).",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_at": {"type": "string"},
                "to_at": {"type": "string"},
                "project_id": {"type": "string"},
            },
            "required": [],
        },
    },
    {
        "name": "gestion_request_tiime_invoice",
        "description": (
            "À partir d'un devis Korymb accepté : déclenche la facturation Tiime (webhook Make) "
            "ou renvoie les instructions. Ne remplace pas la validation dirigeant si sandbox actif."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "quote_id": {"type": "string"},
            },
            "required": ["quote_id"],
        },
    },
]


def _json_ok(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _parse_lines_json(raw: str) -> list[dict]:
    try:
        val = json.loads(raw or "[]")
        if isinstance(val, list):
            return val
    except json.JSONDecodeError:
        pass
    return []


def dispatch_business_tool(name: str, inp: dict[str, Any]) -> str | None:
    handlers: dict[str, Callable[[], str]] = {
        "gestion_overview": lambda: _json_ok({
            "stats": get_business_overview(),
            "hint": "Utilise gestion_search_contacts avant toute création.",
        }),
        "gestion_search_contacts": lambda: _json_ok({
            "contacts": search_contacts(
                str(inp.get("query", "")),
                limit=int(inp.get("limit") or 15),
            ),
        }),
        "gestion_upsert_contact": lambda: _do_upsert_contact(inp),
        "gestion_update_contact": lambda: _do_update_contact(inp),
        "gestion_propose_contact_enrichment": lambda: _do_propose_enrichment(inp),
        "gestion_log_interaction": lambda: _do_log_interaction(inp),
        "gestion_list_interactions": lambda: _json_ok({
            "interactions": list_interactions(
                contact_id=(str(inp.get("contact_id") or "").strip() or None),
                project_id=(str(inp.get("project_id") or "").strip() or None),
                limit=int(inp.get("limit") or 30),
            ),
        }),
        "gestion_create_project": lambda: _do_create_project(inp),
        "gestion_list_projects": lambda: _json_ok({
            "projects": list_projects(
                contact_id=(str(inp.get("contact_id") or "").strip() or None),
                status=(str(inp.get("status") or "").strip() or None),
                limit=int(inp.get("limit") or 30),
            ),
        }),
        "gestion_create_quote": lambda: _do_create_quote(inp),
        "gestion_list_quotes": lambda: _json_ok({
            "quotes": list_quotes(
                contact_id=(str(inp.get("contact_id") or "").strip() or None),
                status=(str(inp.get("status") or "").strip() or None),
                limit=int(inp.get("limit") or 30),
            ),
        }),
        "gestion_schedule_event": lambda: _do_schedule_event(inp),
        "gestion_list_events": lambda: _json_ok({
            "events": list_calendar_events(
                from_at=(str(inp.get("from_at") or "").strip() or None),
                to_at=(str(inp.get("to_at") or "").strip() or None),
                project_id=(str(inp.get("project_id") or "").strip() or None),
            ),
        }),
        "gestion_request_tiime_invoice": lambda: _do_tiime_request(inp),
    }
    fn = handlers.get(name)
    if fn is None:
        return None
    return fn()


def _do_upsert_contact(inp: dict[str, Any]) -> str:
    name = str(inp.get("name") or "").strip()
    if not name:
        return "Erreur gestion : name requis."
    tags = inp.get("tags")
    tag_list = [str(t) for t in tags] if isinstance(tags, list) else []
    contact, created = upsert_contact(
        name=name,
        email=str(inp.get("email") or ""),
        phone=str(inp.get("phone") or ""),
        company=str(inp.get("company") or ""),
        contact_type=str(inp.get("contact_type") or "prospect"),
        tags=tag_list,
        notes=str(inp.get("profile_notes") or ""),
    )
    agent_key = str(inp.get("agent_key") or "")
    job_id = str(inp.get("job_id") or "")
    outreach = str(inp.get("outreach_suggestions") or "").strip()
    if outreach and contact.get("id"):
        from services.business_db import append_outreach_suggestions

        contact = append_outreach_suggestions(str(contact["id"]), outreach, source="prospection") or contact
    log_interaction(
        contact_id=contact.get("id"),
        interaction_type="prospection" if created else "note",
        summary="Contact créé dans Korymb" if created else "Contact enrichi dans Korymb",
        details=str(inp.get("profile_notes") or "")[:4000],
        agent_key=agent_key,
        job_id=job_id,
    )
    return _json_ok({"created": created, "contact": contact})


def _do_update_contact(inp: dict[str, Any]) -> str:
    cid = str(inp.get("contact_id") or "").strip()
    if not cid:
        return "Erreur gestion : contact_id requis."
    patch: dict[str, Any] = {}
    for key in ("contact_type", "status", "email", "phone", "website", "linkedin_url", "address", "city", "postal_code", "company"):
        if inp.get(key):
            patch[key] = str(inp.get(key))
    if inp.get("tags") and isinstance(inp.get("tags"), list):
        patch["tags"] = [str(t) for t in inp["tags"]]
    row = update_contact(cid, **patch) if patch else get_contact(cid)
    if inp.get("append_notes"):
        row = append_contact_notes(cid, str(inp.get("append_notes")), source="agent")
    if not row:
        return f"Erreur gestion : contact {cid} introuvable."
    return _json_ok({"contact": row})


def _do_propose_enrichment(inp: dict[str, Any]) -> str:
    cid = str(inp.get("contact_id") or "").strip()
    if not cid:
        return "Erreur gestion : contact_id requis."
    if not get_contact(cid):
        return f"Erreur gestion : contact {cid} introuvable."
    proposed: dict[str, Any] = {}
    for key in ("email", "phone", "website", "linkedin_url", "address", "city", "postal_code", "company", "notes_append", "outreach_suggestions"):
        if inp.get(key):
            proposed[key] = str(inp.get(key)).strip()
    socials: dict[str, str] = {}
    for key in ("instagram", "facebook", "youtube", "resalib"):
        if inp.get(key):
            socials[key] = str(inp.get(key)).strip()
    if socials:
        proposed["socials"] = socials
    sources = inp.get("sources")
    source_list = [str(s) for s in sources] if isinstance(sources, list) else []
    row = create_enrichment_proposal(
        contact_id=cid,
        proposed=proposed,
        sources=source_list,
        summary=str(inp.get("summary") or ""),
        job_id=str(inp.get("job_id") or ""),
        agent_key=str(inp.get("agent_key") or "commercial"),
    )
    if not row:
        return "Erreur gestion : aucun champ exploitable dans la proposition."
    log_interaction(
        contact_id=cid,
        interaction_type="prospection",
        summary="Proposition d'enrichissement (à valider)",
        details=str(inp.get("summary") or row.get("summary") or "")[:4000],
        agent_key=str(inp.get("agent_key") or "commercial"),
        job_id=str(inp.get("job_id") or ""),
    )
    return _json_ok({
        "proposal": row,
        "hint": "Le dirigeant doit valider le diff dans Gestion → contact avant écriture.",
    })


def _do_log_interaction(inp: dict[str, Any]) -> str:
    cid = str(inp.get("contact_id") or "").strip()
    if not cid:
        return "Erreur gestion : contact_id requis."
    itype = str(inp.get("interaction_type") or "note")
    if itype not in INTERACTION_TYPES:
        itype = "other"
    row = log_interaction(
        contact_id=cid,
        project_id=(str(inp.get("project_id") or "").strip() or None),
        quote_id=(str(inp.get("quote_id") or "").strip() or None),
        interaction_type=itype,
        summary=str(inp.get("summary") or ""),
        details=str(inp.get("details") or ""),
        agent_key=str(inp.get("agent_key") or ""),
        job_id=str(inp.get("job_id") or ""),
    )
    return _json_ok({"interaction": row})


def _do_create_project(inp: dict[str, Any]) -> str:
    title = str(inp.get("title") or "").strip()
    if not title:
        return "Erreur gestion : title requis."
    job_link = str(inp.get("linked_job_id") or "").strip()
    links = [job_link] if job_link else []
    row = create_project(
        title=title,
        contact_id=(str(inp.get("contact_id") or "").strip() or None),
        project_type=str(inp.get("project_type") or "autre"),
        description=str(inp.get("description") or ""),
        location=str(inp.get("location") or ""),
        status=str(inp.get("status") or "active"),
        linked_job_ids=links,
    )
    return _json_ok({"project": row})


def _do_create_quote(inp: dict[str, Any]) -> str:
    title = str(inp.get("title") or "").strip()
    lines = _parse_lines_json(str(inp.get("lines_json") or ""))
    if not title or not lines:
        return "Erreur gestion : title et lines_json (tableau non vide) requis."
    row = create_quote(
        title=title,
        contact_id=(str(inp.get("contact_id") or "").strip() or None),
        project_id=(str(inp.get("project_id") or "").strip() or None),
        lines=lines,
        notes=str(inp.get("notes") or ""),
        status=str(inp.get("status") or "draft"),
    )
    log_interaction(
        contact_id=row.get("contact_id"),
        quote_id=row.get("id"),
        interaction_type="quote",
        summary=f"Devis créé : {row.get('quote_number')}",
        details=title,
        agent_key=str(inp.get("agent_key") or ""),
        job_id=str(inp.get("job_id") or ""),
    )
    return _json_ok({"quote": row})


def _do_schedule_event(inp: dict[str, Any]) -> str:
    title = str(inp.get("title") or "").strip()
    starts = str(inp.get("starts_at") or "").strip()
    if not title or not starts:
        return "Erreur gestion : title et starts_at requis."
    row = create_calendar_event(
        title=title,
        starts_at=starts,
        ends_at=(str(inp.get("ends_at") or "").strip() or None),
        contact_id=(str(inp.get("contact_id") or "").strip() or None),
        project_id=(str(inp.get("project_id") or "").strip() or None),
        event_type=str(inp.get("event_type") or "seance"),
        location=str(inp.get("location") or ""),
        notes=str(inp.get("notes") or ""),
    )
    return _json_ok({"event": row})


def _do_tiime_request(inp: dict[str, Any]) -> str:
    qid = str(inp.get("quote_id") or "").strip()
    if not qid:
        return "Erreur gestion : quote_id requis."
    quote = get_quote(qid)
    if not quote:
        return f"Erreur gestion : devis {qid} introuvable."
    contact = get_contact(quote["contact_id"]) if quote.get("contact_id") else None
    result = request_tiime_invoice(quote, contact)
    if quote.get("status") == "draft":
        update_quote(qid, status="sent")
    return _json_ok(result)
