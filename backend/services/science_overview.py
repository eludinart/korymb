"""Aperçu lecture seule de la science d'entreprise (hub /gestion/science).

Agrège faits, mémoire globale (texte complet + preview court), entités, documents
et offres du guide sans créer de troisième store ni exposer de secrets.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("korymb.science_overview")

_FACT_DISPLAY_KEYS = (
    "brand",
    "tagline",
    "location",
    "offers",
    "activity",
    "tone",
    "icp",
)
_GLOBAL_PREVIEW_CHARS = 420
# Garde-fou payload (pas un teaser) — le hub affiche global_md en markdown.
_GLOBAL_MD_MAX_CHARS = 200_000
_ENTITY_ATTR_LIMIT = 6
_ENTITY_ATTR_VALUE_CHARS = 120
_DOC_RECENT = 6


def _clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _safe_facts(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for key in _FACT_DISPLAY_KEYS:
        if key not in raw:
            continue
        val = raw[key]
        if isinstance(val, list):
            clean = [_clip(x, 80) for x in val if str(x or "").strip()][:12]
            if clean:
                out[key] = clean
        else:
            text = _clip(val, 240)
            if text:
                out[key] = text
    updated = str(raw.get("updated_at") or "").strip()
    if updated:
        out["updated_at"] = updated[:40]
    return out


def _public_entity(entity: dict[str, Any]) -> dict[str, Any]:
    attrs_in = entity.get("attributes") if isinstance(entity.get("attributes"), dict) else {}
    attrs: dict[str, str] = {}
    for key, val in list(attrs_in.items())[:_ENTITY_ATTR_LIMIT]:
        label = str(key or "").strip()[:40]
        if not label:
            continue
        attrs[label] = _clip(val, _ENTITY_ATTR_VALUE_CHARS)
    return {
        "entity_id": entity.get("entity_id"),
        "name": _clip(entity.get("name"), 120),
        "entity_type": _clip(entity.get("entity_type"), 32) or "other",
        "attributes": attrs,
        "updated_at": _clip(entity.get("updated_at"), 40),
    }


def _doc_brief(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc.get("id"),
        "title": _clip(doc.get("title"), 200),
        "summary": _clip(doc.get("summary"), 280),
        "category": _clip(doc.get("category"), 120),
        "tags": [str(t)[:40] for t in (doc.get("tags") or [])[:8] if str(t).strip()],
        "updated_at": _clip(doc.get("updated_at"), 40),
    }


def _calendar_pending_count() -> int:
    try:
        from services.knowledge_documents import migrate_calendar_document_events

        result = migrate_calendar_document_events(dry_run=True)
        return int(result.get("created") or 0)
    except Exception:
        logger.exception("science overview calendar pending count failed")
        return 0


def get_science_overview(*, global_preview_chars: int = _GLOBAL_PREVIEW_CHARS) -> dict[str, Any]:
    from database import get_enterprise_memory
    from services.context_guide import get_state as get_context_guide_state
    from services.knowledge import list_entities
    from services.knowledge_documents import list_knowledge_documents
    from services.memory_inbox import get_enterprise_facts

    facts = _safe_facts(get_enterprise_facts())

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    global_full = str(contexts.get("global") or "").strip()
    if len(global_full) > _GLOBAL_MD_MAX_CHARS:
        global_md = global_full[:_GLOBAL_MD_MAX_CHARS].rstrip() + "\n\n…"
    else:
        global_md = global_full
    limit = max(80, min(int(global_preview_chars), 1200))
    global_preview = {
        "text": _clip(global_full, limit) if global_full else "",
        "chars": len(global_full),
        "has_more": len(global_full) > limit,
    }

    try:
        entities_raw = list_entities()
    except Exception:
        logger.exception("science overview list_entities failed")
        entities_raw = []

    persons: list[dict[str, Any]] = []
    fiches: list[dict[str, Any]] = []
    for entity in entities_raw:
        pub = _public_entity(entity)
        if not pub.get("name"):
            continue
        if str(pub.get("entity_type") or "").lower() == "person":
            persons.append(pub)
        else:
            fiches.append(pub)

    docs = list_knowledge_documents(limit=200)
    recent = [_doc_brief(d) for d in docs[:_DOC_RECENT]]

    guide: dict[str, Any] = {
        "offers": [],
        "offers_mode": "standards",
        "phase": "ask",
        "question": "",
        "started": False,
    }
    try:
        state = get_context_guide_state()
        offers = state.get("offers") if isinstance(state.get("offers"), list) else []
        guide = {
            "offers": [
                {
                    "id": str(o.get("id") or ""),
                    "kind": str(o.get("kind") or ""),
                    "title": _clip(o.get("title"), 160),
                    "hint": _clip(o.get("hint"), 240),
                    "question": _clip(o.get("question"), 400),
                }
                for o in offers[:3]
                if isinstance(o, dict) and str(o.get("id") or "").strip()
            ],
            "offers_mode": str(state.get("offers_mode") or "standards"),
            "phase": str(state.get("phase") or "ask"),
            "question": _clip(state.get("question"), 400),
            "started": bool(state.get("started")),
        }
    except Exception:
        logger.exception("science overview context guide failed")

    return {
        "facts": facts,
        "global_md": global_md,
        "global_preview": global_preview,
        "persons": persons,
        "entities": fiches,
        "documents": {
            "count": len(docs),
            "recent": recent,
        },
        "context_guide": guide,
        "calendar_migrate": {
            "pending_count": _calendar_pending_count(),
        },
        "links": {
            "questionnaire": "/administration/contexte",
            "memory": "/administration/memory",
        },
    }
