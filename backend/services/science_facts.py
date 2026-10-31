"""Faits Identité Science — sanitize, merge, delete (grand public, sans JSON brut)."""
from __future__ import annotations

import re
from typing import Any

from services.memory_inbox import get_enterprise_facts, merge_enterprise_facts

KNOWN_FACT_KEYS = (
    "brand",
    "tagline",
    "location",
    "offers",
    "activity",
    "tone",
    "icp",
    "companies",
    "boats",
    "org",
    "assets",
    "contact_email",
    "intro",
)

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


def slug_fact_key(label: str) -> str:
    """Titre libre → clé technique (snake)."""
    raw = (label or "").strip().lower()
    # accents simples
    for src, dst in (
        ("àáâä", "a"),
        ("éèêë", "e"),
        ("ìíîï", "i"),
        ("òóôö", "o"),
        ("ùúûü", "u"),
        ("ç", "c"),
        ("ñ", "n"),
    ):
        for ch in src:
            raw = raw.replace(ch, dst)
    raw = re.sub(r"[^a-z0-9]+", "_", raw).strip("_")
    if not raw:
        raw = "section"
    if raw[0].isdigit():
        raw = f"s_{raw}"
    return raw[:40]


def sanitize_fact_key(raw: str) -> str:
    key = str(raw or "").strip().lower()[:40]
    if key in KNOWN_FACT_KEYS:
        return key
    if _KEY_RE.match(key):
        return key
    return slug_fact_key(key)


def normalize_fact_value(value: Any) -> str | list[str] | None:
    """Jamais de dict brut stocké — texte ou liste de textes lisibles."""
    if value is None:
        return None
    if isinstance(value, dict):
        parts: list[str] = []
        for k, v in value.items():
            label = str(k or "").strip()
            text = str(v or "").strip()
            if not label and not text:
                continue
            if label and text:
                parts.append(f"{label} : {text}")
            elif label:
                parts.append(label)
            else:
                parts.append(text)
        joined = " · ".join(parts).strip()
        return joined[:500] if joined else None
    if isinstance(value, list):
        items = [str(x).strip()[:120] for x in value if str(x or "").strip()][:20]
        return items or None
    if isinstance(value, bool):
        return "oui" if value else "non"
    if isinstance(value, (int, float)):
        return str(value)[:500]
    text = str(value or "").strip()
    # Dict sérialisé accidentellement en str Python / JSON
    if text.startswith("{") and text.endswith("}"):
        try:
            import json

            parsed = json.loads(text.replace("'", '"'))
            if isinstance(parsed, dict):
                return normalize_fact_value(parsed)
        except Exception:
            pass
    return text[:500] if text else None


def format_fact_for_display(value: Any) -> str:
    """Affichage UI : jamais de dump JSON."""
    if value is None:
        return ""
    if isinstance(value, dict):
        norm = normalize_fact_value(value)
        if isinstance(norm, list):
            return " · ".join(norm)
        return str(norm or "")
    if isinstance(value, list):
        return " · ".join(str(x).strip() for x in value if str(x or "").strip())
    text = str(value or "").strip()
    if text.startswith("{") and ("':" in text or '":' in text):
        norm = normalize_fact_value(text)
        if isinstance(norm, list):
            return " · ".join(norm)
        return str(norm or text)
    return text


def put_science_facts(facts: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(facts, dict) or not facts:
        raise ValueError("Au moins un fait est requis.")
    clean: dict[str, Any] = {}
    for raw_key, raw_val in facts.items():
        key = sanitize_fact_key(str(raw_key or ""))
        if not key or key == "updated_at":
            continue
        norm = normalize_fact_value(raw_val)
        if norm is None:
            continue
        clean[key] = norm
    if not clean:
        raise ValueError("Aucun fait valide à enregistrer.")
    return merge_enterprise_facts(clean)


def delete_science_fact(key: str) -> dict[str, Any]:
    from database import merge_enterprise_contexts
    import json
    from datetime import datetime

    k = sanitize_fact_key(key)
    if not k or k == "updated_at":
        raise ValueError("Clé invalide.")
    cur = dict(get_enterprise_facts())
    if k not in cur:
        raise ValueError("Section introuvable.")
    cur.pop(k, None)
    cur["updated_at"] = datetime.utcnow().isoformat()
    merge_enterprise_contexts({"enterprise_facts": json.dumps(cur, ensure_ascii=False)})
    return cur


def upsert_science_entity(
    *,
    name: str,
    entity_type: str = "person",
    attributes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from services.knowledge import get_entity, upsert_entity

    label = (name or "").strip()
    if not label:
        raise ValueError("Le nom est obligatoire.")
    etype = (entity_type or "person").strip().lower() or "person"
    if etype not in {"person", "company", "activity", "project", "other"}:
        etype = "other"
    attrs_in = attributes if isinstance(attributes, dict) else {}
    attrs: dict[str, Any] = {}
    for ak, av in attrs_in.items():
        key = str(ak or "").strip()[:40]
        if not key:
            continue
        text = str(av or "").strip()[:200]
        if text:
            attrs[key] = text
    upsert_entity(label, etype, attrs, {})
    row = get_entity(label)
    if not row:
        return {"name": label, "entity_type": etype, "attributes": attrs}
    return row
