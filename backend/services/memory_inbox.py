"""Inbox mémoire entreprise — suggestions généralisées (missions, CRM, vitrine)."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

MEMORY_INJECT_MAX_CHARS = 2000
MEMORY_CHAT_GLOBAL_CHARS = 480
MEMORY_CHAT_SUMMARY_CHARS = 360
MEMORY_COMPACT_TARGET_CHARS = 2800
MEMORY_COMPACT_TRIGGER_CHARS = 4500
MEMORY_COMPACT_TTL_HOURS = 168  # 7 jours


def propose_memory_suggestion(
    *,
    title: str,
    learnings: list[str] | None = None,
    suggested_memory_keys: dict[str, str] | None = None,
    suggested_prompt_tweaks: list[str] | None = None,
    enterprise_facts: dict[str, Any] | None = None,
    source: str = "manual",
    job_id: str = "",
    source_ref: str = "",
    notify: bool = True,
) -> dict | None:
    """
    Crée une suggestion mémoire (file Décisions) et tente l'auto-apply selon learning.auto_apply_mode.
    """
    from database import insert_learning_suggestion
    from services.learning import try_auto_apply_learning

    keys = {
        str(k): str(v).strip()
        for k, v in (suggested_memory_keys or {}).items()
        if str(v or "").strip()
    }
    facts = enterprise_facts if isinstance(enterprise_facts, dict) else None
    if not keys and not facts:
        return None

    learnings_list = [str(x).strip() for x in (learnings or []) if str(x or "").strip()][:8]
    if not learnings_list and keys:
        learnings_list = [f"{k}: {v[:160]}" for k, v in list(keys.items())[:4]]

    payload: dict[str, Any] = {
        "title": (title or "Suggestion mémoire")[:160],
        "learnings": learnings_list,
        "suggested_memory_keys": keys,
        "suggested_prompt_tweaks": [
            str(x).strip() for x in (suggested_prompt_tweaks or []) if str(x or "").strip()
        ][:6],
        "source": (source or "manual")[:48],
        "source_ref": (source_ref or "")[:191],
    }
    if facts:
        payload["enterprise_facts"] = facts

    sug = insert_learning_suggestion(job_id or "", payload)
    sid = str(sug.get("id") or "")
    auto_applied = try_auto_apply_learning(sid, payload) if sid else False

    if notify:
        try:
            from services.director_platform import emit_director_notification

            if auto_applied:
                emit_director_notification(
                    kind="learning_suggestion",
                    title=str(payload.get("title") or "Mémoire mise à jour"),
                    body=f"Suggestion mémoire appliquée automatiquement ({source}).",
                    job_id=job_id or None,
                    action_url="/administration/memory",
                )
            else:
                emit_director_notification(
                    kind="learning_suggestion",
                    title=str(payload.get("title") or "Mémoire à confirmer"),
                    body="Nouvelle suggestion mémoire à approuver dans Décisions.",
                    job_id=job_id or None,
                    action_url=f"/inbox?job={job_id}" if job_id else "/inbox",
                )
        except Exception:
            logger.exception("memory inbox notification failed")

    if auto_applied and isinstance(sug, dict):
        sug = dict(sug)
        sug["status"] = "auto_applied"
    return sug


def merge_enterprise_facts(updates: dict[str, Any] | None) -> dict[str, Any]:
    """Fusionne des faits structurés dans contexts.enterprise_facts (clé système)."""
    from database import get_enterprise_memory, merge_enterprise_contexts

    if not updates:
        return get_enterprise_facts()
    cur = get_enterprise_facts()
    merged = dict(cur)
    for k, v in updates.items():
        key = str(k).strip()[:64]
        if not key or key == "updated_at":
            continue
        if isinstance(v, list):
            clean = [str(x).strip() for x in v if str(x or "").strip()][:20]
            if clean:
                merged[key] = clean
        elif isinstance(v, (dict, bool, int, float)):
            merged[key] = v
        else:
            text = str(v or "").strip()
            if text:
                merged[key] = text[:500]
    merged["updated_at"] = datetime.utcnow().isoformat()
    merge_enterprise_contexts({"enterprise_facts": json.dumps(merged, ensure_ascii=False)})
    return merged


def get_enterprise_facts() -> dict[str, Any]:
    from database import get_enterprise_memory

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    raw = contexts.get("enterprise_facts")
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def format_enterprise_facts_prompt(*, max_chars: int = 900) -> str:
    facts = get_enterprise_facts()
    if not facts:
        return ""
    lines: list[str] = ["Faits entreprise (structurés) :"]
    order = ("brand", "tagline", "location", "offers", "icp", "tone", "contact_email")
    seen: set[str] = set()
    for key in order:
        if key not in facts:
            continue
        seen.add(key)
        val = facts[key]
        if isinstance(val, list):
            lines.append(f"- {key}: {', '.join(str(x) for x in val[:8])}")
        else:
            lines.append(f"- {key}: {str(val)[:200]}")
    for key, val in facts.items():
        if key in seen or key == "updated_at":
            continue
        if isinstance(val, list):
            lines.append(f"- {key}: {', '.join(str(x) for x in val[:6])}")
        else:
            lines.append(f"- {key}: {str(val)[:160]}")
    text = "\n".join(lines)
    if len(text) > max_chars:
        return text[: max_chars - 1].rstrip() + "…"
    return text


def build_chat_active_memory_block() -> str:
    """Résumé court + faits pour le chat CIO (sans dump reprise/checklist)."""
    from database import get_enterprise_memory

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    parts: list[str] = [
        "\n\n[Mémoire active — usage interne silencieux, ne pas réciter en checklist]"
    ]
    facts_blk = format_enterprise_facts_prompt(max_chars=700)
    if facts_blk:
        parts.append(facts_blk)
    global_ctx = str(contexts.get("global") or "").strip()
    if global_ctx:
        parts.append("Contexte global (extrait) :\n" + global_ctx[:MEMORY_CHAT_GLOBAL_CHARS])
    summary = str(contexts.get("auto_summary") or "").strip()
    if summary:
        parts.append("Résumé missions :\n" + summary[:MEMORY_CHAT_SUMMARY_CHARS])
    if len(parts) <= 1:
        return ""
    return "\n".join(parts)


def clip_memory_for_injection(text: str, max_chars: int | None = None) -> str:
    limit = max_chars if max_chars is not None else MEMORY_INJECT_MAX_CHARS
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    return t[: max(0, limit - 1)].rstrip() + "…"


def propose_from_crm_enrichment(*, contact: dict | None, proposal: dict | None = None) -> dict | None:
    if not contact:
        return None
    name = str(contact.get("name") or "").strip()
    company = str(contact.get("company") or "").strip()
    ctype = str(contact.get("contact_type") or "").strip()
    city = str(contact.get("city") or "").strip()
    outreach = str(contact.get("outreach_suggestions") or "").strip()
    bits: list[str] = []
    if name:
        bits.append(name)
    if company:
        bits.append(f"entreprise {company}")
    if ctype:
        bits.append(f"type {ctype}")
    if city:
        bits.append(f"à {city}")
    if not bits:
        return None
    fact = "Contact CRM validé : " + ", ".join(bits) + "."
    learnings = [fact]
    if outreach:
        learnings.append(f"Pistes outreach : {outreach[:220]}")
    keys = {"commercial": fact}
    if company or ctype in ("client", "partenaire"):
        keys["global"] = fact
    facts_update: dict[str, Any] = {}
    if company:
        facts_update.setdefault("known_orgs", [])
    # known_orgs merged carefully in apply; here pass company for facts merge on approve
    payload_facts = {"last_crm_contact": name or company}
    if company:
        payload_facts["company_hint"] = company
    return propose_memory_suggestion(
        title=f"Mémoire CRM — {name or company or 'contact'}"[:160],
        learnings=learnings,
        suggested_memory_keys=keys,
        enterprise_facts=payload_facts,
        source="crm_enrichment",
        job_id=str((proposal or {}).get("job_id") or ""),
        source_ref=str(contact.get("id") or ""),
    )


def sync_storefront_brand_to_memory(storefront: dict[str, Any] | None) -> dict | None:
    """Synchronise identité vitrine → faits structurés + suggestion volets mémoire."""
    if not storefront:
        return None
    name = str(storefront.get("name") or "").strip()
    tagline = str(storefront.get("tagline") or "").strip()
    intro = str(storefront.get("intro") or "").strip()
    location = str(storefront.get("location") or "").strip()
    contact_email = str(storefront.get("contact_email") or "").strip()
    offers_raw = storefront.get("offers") if isinstance(storefront.get("offers"), list) else []
    offer_titles = [
        str(o.get("title") or "").strip()
        for o in offers_raw
        if isinstance(o, dict) and str(o.get("title") or "").strip()
    ][:8]

    facts: dict[str, Any] = {}
    if name:
        facts["brand"] = name
    if tagline:
        facts["tagline"] = tagline
    if location:
        facts["location"] = location
    if contact_email:
        facts["contact_email"] = contact_email
    if offer_titles:
        facts["offers"] = offer_titles
    if intro:
        facts["intro"] = intro[:400]

    if not facts:
        return None

    # Faits structurés : écriture directe (données dirigeant explicites via admin vitrine)
    merge_enterprise_facts(facts)

    lines = []
    if name:
        lines.append(f"Marque : {name}.")
    if tagline:
        lines.append(f"Positionnement : {tagline}")
    if location:
        lines.append(f"Lieu : {location}.")
    if offer_titles:
        lines.append("Offres : " + ", ".join(offer_titles) + ".")
    brand_block = " ".join(lines).strip()
    community = brand_block
    if intro:
        community = f"{brand_block} {intro[:280]}".strip()

    return propose_memory_suggestion(
        title=f"Brand kit vitrine — {name or 'espace'}"[:160],
        learnings=lines or [brand_block],
        suggested_memory_keys={
            "global": brand_block[:800],
            "community_manager": community[:1200],
        },
        enterprise_facts=facts,
        source="storefront_sync",
        source_ref=str(storefront.get("slug") or storefront.get("id") or ""),
    )


def _compact_text_heuristic(text: str, *, target: int = MEMORY_COMPACT_TARGET_CHARS) -> str:
    raw = (text or "").strip()
    if len(raw) <= target:
        return raw
    # Garde les dernières lignes (faits récents) + tête
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if len(lines) <= 2:
        return raw[: target - 1].rstrip() + "…"
    head = lines[:3]
    tail: list[str] = []
    size = sum(len(x) for x in head) + 20
    for ln in reversed(lines[3:]):
        if size + len(ln) + 1 > target:
            break
        tail.append(ln)
        size += len(ln) + 1
    merged = head + ["…"] + list(reversed(tail))
    out = "\n".join(merged)
    if len(out) > target:
        return out[: target - 1].rstrip() + "…"
    return out


def compact_enterprise_memory_if_needed(*, force: bool = False) -> dict[str, Any]:
    """
    Compacte les volets métier trop longs. Snapshot avant écriture.
    Retourne un rapport {compacted: bool, keys: [...], reason}.
    """
    from database import (
        _CONTEXT_KEYS_LEGACY,
        get_enterprise_memory,
        merge_enterprise_contexts,
        snapshot_memory_history,
    )

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    compacted_at = str(contexts.get("memory_compacted_at") or "")
    stale = True
    if compacted_at and not force:
        try:
            ts = datetime.fromisoformat(compacted_at.replace("Z", ""))
            age_h = (datetime.utcnow() - ts).total_seconds() / 3600.0
            stale = age_h >= MEMORY_COMPACT_TTL_HOURS
        except ValueError:
            stale = True

    oversized = [
        k
        for k in _CONTEXT_KEYS_LEGACY
        if len(str(contexts.get(k) or "")) > MEMORY_COMPACT_TRIGGER_CHARS
    ]
    if not force and not oversized and not stale:
        return {"compacted": False, "keys": [], "reason": "fresh"}
    if not force and not oversized and stale:
        # TTL seul : ne compacte que si au moins un volet > 70% du trigger
        soft = [
            k
            for k in _CONTEXT_KEYS_LEGACY
            if len(str(contexts.get(k) or "")) > int(MEMORY_COMPACT_TRIGGER_CHARS * 0.7)
        ]
        if not soft:
            merge_enterprise_contexts({"memory_compacted_at": datetime.utcnow().isoformat()})
            return {"compacted": False, "keys": [], "reason": "ttl_mark_only"}
        oversized = soft

    updates: dict[str, str] = {}
    for key in oversized or list(_CONTEXT_KEYS_LEGACY):
        raw = str(contexts.get(key) or "").strip()
        if not raw or len(raw) <= MEMORY_COMPACT_TARGET_CHARS:
            continue
        compacted = raw
        if force or len(raw) > MEMORY_COMPACT_TRIGGER_CHARS:
            try:
                compacted = _llm_compact_volet(key, raw) or _compact_text_heuristic(raw)
            except Exception:
                logger.exception("LLM compact failed for %s", key)
                compacted = _compact_text_heuristic(raw)
        else:
            compacted = _compact_text_heuristic(raw)
        if compacted and compacted != raw:
            updates[key] = compacted

    if not updates:
        merge_enterprise_contexts({"memory_compacted_at": datetime.utcnow().isoformat()})
        return {"compacted": False, "keys": [], "reason": "nothing_to_shrink"}

    try:
        snapshot_memory_history(comment="auto — compaction mémoire")
    except Exception:
        logger.exception("snapshot before compaction failed")
    updates["memory_compacted_at"] = datetime.utcnow().isoformat()
    merge_enterprise_contexts(updates)
    return {"compacted": True, "keys": [k for k in updates if k != "memory_compacted_at"], "reason": "ok"}


def _llm_compact_volet(key: str, text: str) -> str | None:
    from llm_client import llm_turn

    system = (
        "Tu compactes un volet de mémoire entreprise Korymb. "
        "Garde les faits durables (marque, offres, clients, contraintes, ton). "
        "Supprime doublons et détails obsolètes. Maximum 450 mots en français. Texte seul."
    )
    out, _, _ = llm_turn(
        system,
        f"Volet « {key} » :\n\n{text[:8000]}",
        max_tokens=900,
        or_profile="lite",
        usage_context="memory:compact",
    )
    cleaned = (out or "").strip()
    return cleaned[:4000] if cleaned else None


def maybe_compact_on_memory_touch() -> None:
    try:
        compact_enterprise_memory_if_needed(force=False)
    except Exception:
        logger.exception("maybe_compact_on_memory_touch failed")
