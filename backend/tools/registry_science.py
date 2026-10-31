"""
registry_science.py — Outils agents pour la Science de l'entreprise.

Écriture immédiate (pas de proposition Décisions) : le dirigeant dit « ok » dans le chat,
l'assistant matérialise Identité (faits), fiches/personnes (entités) et documents —
visibles tout de suite sur /gestion/science.
"""
from __future__ import annotations

import json
from typing import Any, Callable

_FACT_KEYS = frozenset({
    "brand",
    "tagline",
    "location",
    "offers",
    "activity",
    "tone",
    "icp",
    "assets",
    "org",
    "boats",
    "companies",
    "contact_email",
    "intro",
})

_ENTITY_TYPES = frozenset({
    "person",
    "company",
    "activity",
    "project",
    "other",
})

SCIENCE_TAG_TO_TOOLS: dict[str, tuple[str, ...]] = {
    "knowledge": (
        "science_overview",
        "science_list_documents",
        "science_get_document",
        "science_create_document",
        "science_update_document",
        "science_list_entities",
        "science_merge_facts",
        "science_upsert_entity",
    ),
}

SCIENCE_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "science_overview",
        "description": (
            "Aperçu lecture seule du hub Science de l'entreprise : faits, extrait mémoire, "
            "fiches, documents récents. À appeler avant de créer pour éviter les doublons."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "science_list_documents",
        "description": (
            "Liste les documents Science (knowledge_documents) actifs. "
            "Filtre optionnel par catégorie, projet ou texte libre."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Recherche titre / résumé / tags"},
                "category": {
                    "type": "string",
                    "description": "Ex: Stratégie | Offre | Process | Référence | Note",
                },
                "project_id": {"type": "string"},
                "limit": {"type": "integer", "description": "Max résultats (défaut 30)"},
            },
            "required": [],
        },
    },
    {
        "name": "science_get_document",
        "description": "Lit un document Science par id (contenu markdown inclus).",
        "input_schema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "description": "Id kd-…"},
            },
            "required": ["document_id"],
        },
    },
    {
        "name": "science_create_document",
        "description": (
            "Crée immédiatement un document dans Science de l'entreprise "
            "(/gestion/science). Une sous-section = un document avec une catégorie claire. "
            "Après accord du dirigeant (« ok »), appelle cet outil — ne lui demande pas "
            "de créer la structure à la main dans Gestion."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string", "description": "Résumé court visible dans le hub"},
                "content_md": {"type": "string", "description": "Corps markdown"},
                "category": {
                    "type": "string",
                    "description": "Ex: Stratégie | Offre | Process | Référence | Note",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tags courts",
                },
                "project_id": {"type": "string"},
                "author": {"type": "string", "description": "Défaut : assistant"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "science_update_document",
        "description": (
            "Met à jour immédiatement un document Science existant "
            "(titre, résumé, contenu, catégorie, tags)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "content_md": {"type": "string"},
                "category": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "project_id": {"type": "string"},
                "author": {"type": "string"},
            },
            "required": ["document_id"],
        },
    },
    {
        "name": "science_list_entities",
        "description": (
            "Liste les fiches Science (personnes, sociétés, activités, projets). "
            "À appeler avant science_upsert_entity pour éviter les doublons."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Filtre optionnel (nom / type)"},
                "entity_type": {
                    "type": "string",
                    "description": "person | company | activity | project | other",
                },
            },
            "required": [],
        },
    },
    {
        "name": "science_merge_facts",
        "description": (
            "Écrit immédiatement les faits structurés Identité du hub Science "
            "(brand, tagline, location, offers, activity, tone, icp, companies, boats, org…). "
            "Fusionne avec l'existant. Après « ok », utilise cet outil pour matérialiser "
            "le contexte confirmé — ne renvoie pas au questionnaire."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "facts": {
                    "type": "object",
                    "description": (
                        "Objet de faits (string ou liste de strings). "
                        "Clés : brand, tagline, location, offers, activity, tone, icp, "
                        "companies, boats, org, assets, contact_email, intro."
                    ),
                },
                "facts_json": {
                    "type": "string",
                    "description": "Alternative JSON string si facts objet non supporté",
                },
            },
            "required": [],
        },
    },
    {
        "name": "science_upsert_entity",
        "description": (
            "Crée ou met à jour immédiatement une fiche Science "
            "(Dirigeant si person, sinon Fiches). "
            "Ex: dirigeant, société, activité maritime, projet."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "entity_type": {
                    "type": "string",
                    "description": "person | company | activity | project | other",
                },
                "attributes": {
                    "type": "object",
                    "description": "Attributs libres (rôle, structure juridique, bateaux…)",
                },
                "attributes_json": {
                    "type": "string",
                    "description": "Alternative JSON string pour attributes",
                },
                "relations": {
                    "type": "object",
                    "description": "Relations optionnelles (parent, linked_to…)",
                },
                "relations_json": {
                    "type": "string",
                    "description": "Alternative JSON string pour relations",
                },
            },
            "required": ["name"],
        },
    },
]


def _json_ok(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _parse_tags(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()][:24]
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return _parse_tags(parsed)
        except json.JSONDecodeError:
            return [p.strip() for p in raw.split(",") if p.strip()][:24]
    return []


def _parse_object(raw: Any, *, json_fallback: Any = None) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    for candidate in (raw, json_fallback):
        if isinstance(candidate, str) and candidate.strip():
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue
    return {}


def dispatch_science_tool(name: str, inp: dict[str, Any]) -> str | None:
    handlers: dict[str, Callable[[], str]] = {
        "science_overview": _do_overview,
        "science_list_documents": lambda: _do_list(inp),
        "science_get_document": lambda: _do_get(inp),
        "science_create_document": lambda: _do_create(inp),
        "science_update_document": lambda: _do_update(inp),
        "science_list_entities": lambda: _do_list_entities(inp),
        "science_merge_facts": lambda: _do_merge_facts(inp),
        "science_upsert_entity": lambda: _do_upsert_entity(inp),
    }
    fn = handlers.get(name)
    if fn is None:
        return None
    return fn()


def _do_overview() -> str:
    from services.science_overview import get_science_overview

    overview = get_science_overview()
    facts = overview.get("facts") if isinstance(overview.get("facts"), dict) else {}
    persons = overview.get("persons") if isinstance(overview.get("persons"), list) else []
    entities = overview.get("entities") if isinstance(overview.get("entities"), list) else []
    docs = overview.get("documents") if isinstance(overview.get("documents"), dict) else {}
    global_preview = overview.get("global_preview") if isinstance(overview.get("global_preview"), dict) else {}
    empty_structured = (
        len([k for k in facts if k != "updated_at"]) == 0
        and len(persons) == 0
        and len(entities) == 0
        and int(docs.get("count") or 0) == 0
    )
    has_context = int(global_preview.get("chars") or 0) > 80 or bool(
        str(overview.get("global_md") or "").strip()
    )
    hint = (
        "Pour matérialiser : science_merge_facts (Identité) + science_upsert_entity "
        "(Dirigeant / Fiches) + science_create_document (Documents). "
        "Visible sur /gestion/science."
    )
    if has_context and empty_structured:
        hint = (
            "Contexte confirmé présent mais Identité / fiches / documents vides. "
            "Propose une matérialisation, puis dès « ok » : science_merge_facts, "
            "science_upsert_entity, science_create_document — pas le questionnaire."
        )
    return _json_ok({"overview": overview, "hint": hint})


def _do_list(inp: dict[str, Any]) -> str:
    from services.knowledge_documents import list_knowledge_documents

    docs = list_knowledge_documents(
        q=(str(inp.get("query") or "").strip() or None),
        category=(str(inp.get("category") or "").strip() or None),
        project_id=(str(inp.get("project_id") or "").strip() or None),
        limit=int(inp.get("limit") or 30),
    )
    briefs = [
        {
            "id": d.get("id"),
            "title": d.get("title"),
            "summary": (str(d.get("summary") or "")[:280]),
            "category": d.get("category"),
            "tags": d.get("tags") or [],
            "updated_at": d.get("updated_at"),
        }
        for d in docs
    ]
    return _json_ok({"documents": briefs, "count": len(briefs)})


def _do_get(inp: dict[str, Any]) -> str:
    from services.knowledge_documents import get_knowledge_document

    doc_id = str(inp.get("document_id") or "").strip()
    if not doc_id:
        return "Erreur science : document_id requis."
    row = get_knowledge_document(doc_id)
    if not row:
        return f"Erreur science : document {doc_id} introuvable."
    return _json_ok({"document": row})


def _do_create(inp: dict[str, Any]) -> str:
    from services.knowledge_documents import create_knowledge_document

    title = str(inp.get("title") or "").strip()
    if not title:
        return "Erreur science : title requis."
    try:
        row = create_knowledge_document(
            title=title,
            summary=str(inp.get("summary") or ""),
            content_md=str(inp.get("content_md") or ""),
            project_id=(str(inp.get("project_id") or "").strip() or None),
            tags=_parse_tags(inp.get("tags")),
            category=str(inp.get("category") or ""),
            author=str(inp.get("author") or "assistant").strip() or "assistant",
        )
    except ValueError as exc:
        return f"Erreur science : {exc}"
    return _json_ok(
        {
            "written": True,
            "document": row,
            "hub": "/gestion/science",
            "open": f"/gestion/science/{row.get('id')}",
        }
    )


def _do_update(inp: dict[str, Any]) -> str:
    from services.knowledge_documents import update_knowledge_document

    doc_id = str(inp.get("document_id") or "").strip()
    if not doc_id:
        return "Erreur science : document_id requis."
    fields: dict[str, Any] = {}
    for key in ("title", "summary", "content_md", "category", "author"):
        if key in inp and inp.get(key) is not None:
            fields[key] = inp.get(key)
    if "tags" in inp:
        fields["tags"] = _parse_tags(inp.get("tags"))
    if "project_id" in inp:
        fields["project_id"] = str(inp.get("project_id") or "").strip() or None
    if not fields:
        return "Erreur science : aucun champ à mettre à jour."
    try:
        row = update_knowledge_document(doc_id, **fields)
    except ValueError as exc:
        return f"Erreur science : {exc}"
    if not row:
        return f"Erreur science : document {doc_id} introuvable."
    return _json_ok(
        {
            "written": True,
            "document": row,
            "hub": "/gestion/science",
            "open": f"/gestion/science/{row.get('id')}",
        }
    )


def _do_list_entities(inp: dict[str, Any]) -> str:
    from services.knowledge import list_entities, search_entities

    query = str(inp.get("query") or "").strip()
    etype = str(inp.get("entity_type") or "").strip().lower()
    rows = search_entities(query) if query else list_entities()
    if etype:
        rows = [r for r in rows if str(r.get("entity_type") or "").lower() == etype]
    briefs = [
        {
            "entity_id": r.get("entity_id"),
            "name": r.get("name"),
            "entity_type": r.get("entity_type"),
            "attributes": r.get("attributes") or {},
            "updated_at": r.get("updated_at"),
        }
        for r in rows[:40]
    ]
    return _json_ok({"entities": briefs, "count": len(briefs)})


def _do_merge_facts(inp: dict[str, Any]) -> str:
    from services.memory_inbox import merge_enterprise_facts

    raw = _parse_object(inp.get("facts"), json_fallback=inp.get("facts_json"))
    if not raw:
        return "Erreur science : facts (objet) ou facts_json requis."
    clean: dict[str, Any] = {}
    for key, val in raw.items():
        k = str(key or "").strip()
        if k not in _FACT_KEYS:
            continue
        if isinstance(val, list):
            items = [str(x).strip()[:120] for x in val if str(x or "").strip()][:12]
            if items:
                clean[k] = items
        else:
            text = str(val or "").strip()
            if text:
                clean[k] = text[:500]
    if not clean:
        return (
            "Erreur science : aucun fait reconnu. "
            "Clés : " + ", ".join(sorted(_FACT_KEYS))
        )
    merged = merge_enterprise_facts(clean)
    return _json_ok(
        {
            "written": True,
            "facts": merged,
            "hub": "/gestion/science",
            "section": "Identité",
        }
    )


def _do_upsert_entity(inp: dict[str, Any]) -> str:
    from services.knowledge import get_entity, upsert_entity

    name = str(inp.get("name") or "").strip()
    if not name:
        return "Erreur science : name requis."
    etype = str(inp.get("entity_type") or "other").strip().lower() or "other"
    if etype not in _ENTITY_TYPES:
        etype = "other"
    attributes = _parse_object(inp.get("attributes"), json_fallback=inp.get("attributes_json"))
    relations = _parse_object(inp.get("relations"), json_fallback=inp.get("relations_json"))
    for key, val in inp.items():
        if key in {
            "name",
            "entity_type",
            "attributes",
            "attributes_json",
            "relations",
            "relations_json",
        }:
            continue
        if isinstance(val, (str, int, float, bool)) and str(val).strip():
            attributes.setdefault(str(key)[:40], str(val).strip()[:200])
    try:
        upsert_entity(name, etype, attributes, relations)
    except ValueError as exc:
        return f"Erreur science : {exc}"
    row = get_entity(name) or {
        "name": name,
        "entity_type": etype,
        "attributes": attributes,
        "relations": relations,
    }
    section = "Dirigeant" if etype == "person" else "Fiches"
    return _json_ok(
        {
            "written": True,
            "entity": row,
            "hub": "/gestion/science",
            "section": section,
        }
    )
