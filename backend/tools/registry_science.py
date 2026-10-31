"""
registry_science.py — Outils agents pour la Science de l'entreprise (knowledge_documents).

Écriture immédiate (pas de proposition Décisions) : le dirigeant dit « ok » dans le chat,
l'assistant appelle science_create_document / science_update_document et le hub
/gestion/science reflète le résultat tout de suite.
"""
from __future__ import annotations

import json
from typing import Any, Callable

SCIENCE_TAG_TO_TOOLS: dict[str, tuple[str, ...]] = {
    "knowledge": (
        "science_overview",
        "science_list_documents",
        "science_get_document",
        "science_create_document",
        "science_update_document",
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


def dispatch_science_tool(name: str, inp: dict[str, Any]) -> str | None:
    handlers: dict[str, Callable[[], str]] = {
        "science_overview": _do_overview,
        "science_list_documents": lambda: _do_list(inp),
        "science_get_document": lambda: _do_get(inp),
        "science_create_document": lambda: _do_create(inp),
        "science_update_document": lambda: _do_update(inp),
    }
    fn = handlers.get(name)
    if fn is None:
        return None
    return fn()


def _do_overview() -> str:
    from services.science_overview import get_science_overview

    overview = get_science_overview()
    return _json_ok(
        {
            "overview": overview,
            "hint": (
                "Pour matérialiser une structure : science_list_documents puis "
                "science_create_document (une sous-section = un document + catégorie). "
                "Visible sur /gestion/science."
            ),
        }
    )


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
