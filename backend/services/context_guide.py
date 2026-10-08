"""
Guide de prise de connaissance — questions pour enrichir le contexte d'un espace.

La première question est neutre. Les suivantes sont tirées du contexte déjà écrit
(mémoire, faits, fiches, et ce que le reste de l'application a appris).
Rien n'est enregistré sans confirmation.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import unicodedata
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

SESSION_KEY = "context_guide.session"
OPENING_QUESTION = "Décrivez avec vos mots ce que vous voulez suivre dans cet espace."
HOLD_MESSAGE = (
    "Le contexte tient pour l'instant. Vous pouvez ajouter quelque chose, ou revenir plus tard. "
    "Entre-temps, l'application continue d'apprendre à partir de vos échanges : "
    "ces ajouts se confirment dans Décisions, et le guide en tiendra compte ici."
)
NEXT_FALLBACK = "Qu'est-ce que vous voulez préciser à partir de ce que vous venez d'écrire ?"
FREE_ADD_QUESTION = "Qu'est-ce que vous voulez ajouter au contexte ?"
CLARIFY_FALLBACK = "Dites-en un peu plus, avec vos mots."

_MEMORY_KEYS = ("global", "commercial", "comptable", "community_manager", "developpeur")
_FACT_KEYS = ("brand", "location", "offers", "tone", "tagline", "activity")
_ENTITY_TYPES = frozenset({"person", "activity", "offer", "place", "other"})

_INTERPRET_SYSTEM = """Tu aides à remplir la base de connaissance d'un espace.
Tu ne connais pas le métier à l'avance : tu n'utilises que le contexte déjà écrit et la dernière réponse.
Réponds uniquement en JSON :
{
  "vague": false,
  "clarification": "",
  "summary": "une ou deux phrases, uniquement des faits dit par la personne",
  "memory": {"global": "phrases à ajouter"},
  "facts": {"brand": "", "location": "", "offers": "", "tone": "", "activity": ""},
  "entities": [{"name": "", "entity_type": "person|activity|offer|place|other", "attributes": {}, "relations": {"lien": ["Autre nom"]}}]
}
Règles :
- vague=true si la réponse n'apporte aucun fait nouveau. clarification reprend un mot de la personne et demande une précision. summary vide.
- N'invente pas de nom, de prix, de lieu ou de métier.
- memory.global pour l'essentiel. commercial ou comptable seulement si un prix, une offre ou un client est dit. community_manager seulement si le ton ou des canaux sont dit. developpeur seulement si un outil ou un site est dit.
- N'ajoute pas une phrase déjà présente dans le contexte.
- entities : personnes, activités, offres ou lieux réellement nommés.
"""

_NEXT_SYSTEM = """Tu poses UNE question pour enrichir un contexte déjà écrit.
Tu ne supposes aucun métier qui n'est pas dans le contexte.
Réponds uniquement en JSON : {"ask": true, "question": "..."}
Règles :
- La question cite un élément déjà dit et vise le trou le plus utile (qui fait quoi, ce qui bloque, ce qui est interdit, une priorité).
- Une seule question, en français, sans liste.
- ask=false et question vide seulement si le contexte dit déjà de quoi il s'agit, avec qui, et une contrainte ou une priorité.
"""


def _now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def _empty_session() -> dict[str, Any]:
    return {
        "phase": "ask",
        "current_question": OPENING_QUESTION,
        "question_fingerprint": "",
        "clarify_rounds": 0,
        "pending": None,
        "turns": [],
        "notice": "",
        "dismissed": [],
        "view": "list",
    }


def _load_session() -> dict[str, Any]:
    from database import get_behavior_setting

    raw = get_behavior_setting(SESSION_KEY)
    if not isinstance(raw, dict):
        return _empty_session()
    session = _empty_session()
    phase = str(raw.get("phase") or "ask")
    session["phase"] = phase if phase in {"ask", "confirm", "hold"} else "ask"
    question = str(raw.get("current_question") or "").strip()
    session["current_question"] = question or OPENING_QUESTION
    session["question_fingerprint"] = str(raw.get("question_fingerprint") or "")
    try:
        session["clarify_rounds"] = max(0, int(raw.get("clarify_rounds") or 0))
    except (TypeError, ValueError):
        session["clarify_rounds"] = 0
    pending = raw.get("pending")
    session["pending"] = pending if isinstance(pending, dict) else None
    turns = raw.get("turns")
    session["turns"] = [t for t in turns if isinstance(t, dict)][-40:] if isinstance(turns, list) else []
    session["notice"] = str(raw.get("notice") or "")[:300]
    dismissed = raw.get("dismissed")
    session["dismissed"] = [str(x) for x in dismissed if str(x).strip()][:40] if isinstance(dismissed, list) else []
    stored_view = str(raw.get("view") or "")
    if stored_view in {"list", "form"}:
        session["view"] = stored_view
    elif session["current_question"] and session["current_question"] != OPENING_QUESTION:
        session["view"] = "form"
    if session["phase"] != "confirm":
        session["pending"] = None
    elif not session["pending"]:
        session["phase"] = "ask"
    return session


def _save_session(session: dict[str, Any]) -> None:
    from database import upsert_behavior_setting

    upsert_behavior_setting(SESSION_KEY, session)


def _context_parts() -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    from database import get_enterprise_memory
    from services.knowledge import list_entities
    from services.memory_inbox import get_enterprise_facts

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    lines: list[str] = []
    for key in _MEMORY_KEYS:
        text = str(contexts.get(key) or "").strip()
        if text:
            lines.append(f"[{key}]\n{text[:1500]}")
    facts = get_enterprise_facts()
    fact_view = {k: facts.get(k) for k in _FACT_KEYS if str(facts.get(k) or "").strip()}
    if fact_view:
        lines.append("Faits : " + json.dumps(fact_view, ensure_ascii=False)[:800])
    try:
        entities = list_entities()
    except Exception:
        logger.exception("context guide list_entities failed")
        entities = []
    if entities:
        brief = ", ".join(
            f"{e.get('name')} ({e.get('entity_type')})" for e in entities[:20] if e.get("name")
        )
        if brief:
            lines.append("Fiches : " + brief[:800])
    body = "\n\n".join(lines) or "(contexte encore vide)"
    return body[:4500], facts if isinstance(facts, dict) else {}, entities


def _fingerprint() -> str:
    brief, _, entities = _context_parts()
    names = ",".join(sorted(str(e.get("name") or "") for e in entities if e.get("name")))
    raw = brief + "\n" + names
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _parse_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start:end])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _llm_json(system: str, user: str, *, usage_context: str, max_tokens: int) -> dict[str, Any] | None:
    try:
        from llm_client import llm_turn

        text, _, _ = llm_turn(
            system,
            user,
            max_tokens=max_tokens,
            or_profile="lite",
            usage_context=usage_context,
            temperature=0.2,
            request_timeout=25,
        )
    except Exception:
        logger.exception("context guide llm failed (%s)", usage_context)
        return None
    return _parse_json_object(str(text or ""))


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        low = value.strip().lower()
        if low in {"1", "true", "oui", "yes"}:
            return True
        if low in {"0", "false", "non", "no"}:
            return False
    if value is None:
        return default
    return bool(value)


def _literal_proposal(answer: str) -> dict[str, Any]:
    summary = _clip(answer, 800)
    return {"summary": summary, "memory": {"global": summary}, "facts": {}, "entities": []}


def _sanitize_proposal(parsed: dict[str, Any] | None, fallback_text: str) -> dict[str, Any]:
    if not parsed:
        return _literal_proposal(fallback_text)
    summary = _clip(parsed.get("summary"), 800)
    memory_in = parsed.get("memory") if isinstance(parsed.get("memory"), dict) else {}
    memory: dict[str, str] = {}
    for key in _MEMORY_KEYS:
        fragment = _clip(memory_in.get(key), 800)
        if fragment:
            memory[key] = fragment
    facts_in = parsed.get("facts") if isinstance(parsed.get("facts"), dict) else {}
    facts: dict[str, str] = {}
    for key in _FACT_KEYS:
        raw = facts_in.get(key)
        if isinstance(raw, list):
            text = ", ".join(str(x).strip() for x in raw if str(x).strip())
        else:
            text = _clip(raw, 300)
        if text:
            facts[key] = text
    entities: list[dict[str, Any]] = []
    raw_entities = parsed.get("entities") if isinstance(parsed.get("entities"), list) else []
    for item in raw_entities[:8]:
        if not isinstance(item, dict):
            continue
        name = _clip(item.get("name"), 80)
        if len(name) < 2:
            continue
        etype = _clip(item.get("entity_type"), 32).lower() or "other"
        if etype not in _ENTITY_TYPES:
            etype = "other"
        attrs_in = item.get("attributes") if isinstance(item.get("attributes"), dict) else {}
        attributes = {
            _clip(k, 40): _clip(v, 200)
            for k, v in list(attrs_in.items())[:8]
            if _clip(k, 40) and _clip(v, 200)
        }
        rels_in = item.get("relations") if isinstance(item.get("relations"), dict) else {}
        relations: dict[str, list[str]] = {}
        for key, targets in list(rels_in.items())[:6]:
            rel = _clip(key, 40)
            if not rel:
                continue
            if isinstance(targets, str):
                names = [_clip(targets, 80)]
            elif isinstance(targets, list):
                names = [_clip(t, 80) for t in targets[:4]]
            else:
                names = []
            names = [n for n in names if n]
            if names:
                relations[rel] = names
        entities.append(
            {"name": name, "entity_type": etype, "attributes": attributes, "relations": relations}
        )
    if not summary and memory.get("global"):
        summary = memory["global"]
    if not summary:
        return _literal_proposal(fallback_text)
    if not memory:
        memory = {"global": summary}
    return {"summary": summary, "memory": memory, "facts": facts, "entities": entities}


def _recent_turns_text(session: dict[str, Any]) -> str:
    lines: list[str] = []
    for turn in session.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        q = _clip(turn.get("question"), 240)
        recorded = _clip(turn.get("recorded"), 400)
        if q or recorded:
            lines.append(f"Q : {q}\nRetenu : {recorded}")
    return "\n\n".join(lines[-6:])


_STANDARDS: tuple[dict[str, str], ...] = (
    {
        "id": "standard-chiffres",
        "title": "Tenir les chiffres",
        "hint": "Devis, factures, échéances. Un standard de gestion, pas le portrait de votre activité.",
        "question": "Comment suivez-vous les devis, les factures et les échéances, si vous en avez ?",
    },
    {
        "id": "standard-personnes",
        "title": "Suivre les personnes",
        "hint": "Clients, adhérents, contacts. Vous pouvez masquer ce point s'il ne vous concerne pas.",
        "question": "Qui sont les personnes ou les organisations que vous suivez, et comment les retrouvez-vous ?",
    },
    {
        "id": "standard-offre",
        "title": "Préparer une offre",
        "hint": "Ce que vous proposez, à qui, dans quel cadre.",
        "question": "Que proposez-vous, à qui, et dans quel cadre ?",
    },
)

_GAP_RULES: tuple[dict[str, Any], ...] = (
    {
        "id": "gap-chiffres",
        "title": "Les chiffres",
        "hint": "Un prix, un devis ou une échéance a été évoqué, sans dire comment ça se décide.",
        "needles": ("devis", "facture", "tarif", "prix", "euro", "paiement", "echeance"),
        "question": "Vous avez parlé de « {quote} ». Qui décide du prix, et comment un devis ou une facture part ?",
    },
    {
        "id": "gap-personnes",
        "title": "Les personnes suivies",
        "hint": "Des contacts sont cités, sans dire comment vous les retrouvez d'une fois sur l'autre.",
        "needles": ("client", "adherent", "contact", "ecole", "groupe", "comite", "participant"),
        "question": "Vous avez parlé de « {quote} ». Comment suivez-vous ces personnes ou ces organisations ensuite ?",
    },
    {
        "id": "gap-offre",
        "title": "L'offre",
        "hint": "Une offre est nommée, sans durée, sans cadre ou sans nombre de places.",
        "needles": ("offre", "sortie", "prestation", "sejour", "atelier", "formule"),
        "question": "Vous avez parlé de « {quote} ». Quelle durée, quel cadre, et pour combien de personnes ?",
    },
)


def _fold(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in nfkd if not unicodedata.combining(c)).casefold()


def _activity_bundle() -> dict[str, Any]:
    from database import get_enterprise_memory
    from services.memory_inbox import get_enterprise_facts

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    facts = get_enterprise_facts()
    missions: list[str] = []
    for item in (mem.get("recent_missions") or [])[:8]:
        if isinstance(item, dict):
            missions.append(str(item.get("mission") or "")[:400])
    _, _, entities = _context_parts()
    chunks = [str(contexts.get(key) or "") for key in _MEMORY_KEYS]
    chunks.extend(missions)
    text = "\n".join(part.strip() for part in chunks if part and part.strip())
    return {
        "text": text,
        "folded": _fold(text),
        "global": str(contexts.get("global") or "").strip(),
        "commercial": str(contexts.get("commercial") or "").strip(),
        "comptable": str(contexts.get("comptable") or "").strip(),
        "facts": facts if isinstance(facts, dict) else {},
        "entities": entities,
        "missions": missions,
    }


def _context_is_thin() -> bool:
    bundle = _activity_bundle()
    facts = bundle["facts"]
    has_fact = any(str(facts.get(key) or "").strip() for key in ("brand", "offers", "activity", "location"))
    has_entity = any(item.get("name") for item in bundle["entities"])
    has_mission = any(len(item.strip()) > 40 for item in bundle["missions"])
    return len(bundle["global"]) < 40 and not has_fact and not has_entity and not has_mission


def _sentence_with(text: str, needles: tuple[str, ...]) -> str:
    chunks = re.split(r"(?<=[\.\!\?\n])\s+|\n+", text)
    folded_needles = tuple(_fold(n) for n in needles)
    for chunk in chunks:
        folded = _fold(chunk)
        if any(needle in folded for needle in folded_needles):
            return _clip(chunk, 160)
    return ""


def _gap_filled(rule_id: str, bundle: dict[str, Any]) -> bool:
    if rule_id == "gap-chiffres":
        return len(bundle["comptable"]) >= 40
    people = [e for e in bundle["entities"] if str(e.get("entity_type") or "") == "person"]
    if rule_id == "gap-personnes":
        return len(bundle["commercial"]) >= 40 or len(people) >= 2
    if rule_id == "gap-offre":
        if str((bundle["facts"] or {}).get("offers") or "").strip():
            return True
        folded = bundle["folded"]
        has_frame = any(token in folded for token in ("duree", "places", "personne"))
        return len(bundle["commercial"]) >= 80 and has_frame
    return False


def _offers(session: dict[str, Any]) -> list[dict[str, str]]:
    dismissed = set(session.get("dismissed") or [])
    if _context_is_thin():
        return [
            {"id": item["id"], "kind": "standard", "title": item["title"], "hint": item["hint"], "question": item["question"]}
            for item in _STANDARDS
            if item["id"] not in dismissed
        ]
    bundle = _activity_bundle()
    found: list[dict[str, str]] = []
    for rule in _GAP_RULES:
        if rule["id"] in dismissed or _gap_filled(str(rule["id"]), bundle):
            continue
        if not any(needle in bundle["folded"] for needle in rule["needles"]):
            continue
        quote = _sentence_with(bundle["text"], tuple(rule["needles"]))
        if not quote:
            continue
        found.append(
            {
                "id": str(rule["id"]),
                "kind": "gap",
                "title": str(rule["title"]),
                "hint": str(rule["hint"]),
                "question": str(rule["question"]).format(quote=quote.strip(" .")),
            }
        )
    return found[:3]


def _offer_by_id(session: dict[str, Any], offer_id: str) -> dict[str, str] | None:
    for item in _offers(session):
        if item["id"] == offer_id:
            return item
    return None


def _public_state(session: dict[str, Any]) -> dict[str, Any]:
    brief, _, entities = _context_parts()
    fingerprint = _fingerprint()
    phase = session.get("phase") or "ask"
    started = bool(session.get("turns"))
    stale = bool(started and phase in {"ask", "hold"} and session.get("question_fingerprint") not in {"", fingerprint})
    pending = session.get("pending") if phase == "confirm" and isinstance(session.get("pending"), dict) else None
    proposal = pending.get("proposal") if isinstance(pending, dict) else None
    names = [str(e.get("name")) for e in entities if e.get("name")]
    global_text = ""
    if brief.startswith("[global]"):
        global_text = brief.split("\n\n", 1)[0].replace("[global]\n", "", 1)[:600]
    return {
        "phase": phase,
        "question": session.get("current_question") or OPENING_QUESTION,
        "hold_message": HOLD_MESSAGE if phase == "hold" else "",
        "notice": session.get("notice") or "",
        "question_stale": stale,
        "pending": {
            "question": pending.get("question"),
            "answer": pending.get("answer"),
            "summary": (proposal or {}).get("summary") or "",
            "memory": (proposal or {}).get("memory") or {},
            "facts": (proposal or {}).get("facts") or {},
            "entities": (proposal or {}).get("entities") or [],
        }
        if pending and proposal
        else None,
        "turns": [
            {
                "question": _clip(t.get("question"), 400),
                "answer": _clip(t.get("answer"), 800),
                "recorded": _clip(t.get("recorded"), 800),
                "at": _clip(t.get("at"), 40),
            }
            for t in (session.get("turns") or [])[-12:]
            if isinstance(t, dict)
        ],
        "context_preview": global_text,
        "known_entities": names[:20],
        "started": started,
        "offers": _offers(session),
        "offers_mode": "standards" if _context_is_thin() else "gaps",
        "view": "form" if session.get("view") == "form" else "list",
    }


def get_state() -> dict[str, Any]:
    return _public_state(_load_session())


def _ask_clarification(session: dict[str, Any], question: str) -> dict[str, Any]:
    session["phase"] = "ask"
    session["current_question"] = _clip(question, 400) or CLARIFY_FALLBACK
    session["pending"] = None
    session["clarify_rounds"] = int(session.get("clarify_rounds") or 0) + 1
    session["notice"] = ""
    session["question_fingerprint"] = _fingerprint()
    _save_session(session)
    return _public_state(session)


def _set_next_question(session: dict[str, Any]) -> dict[str, Any]:
    brief, _, _ = _context_parts()
    turns = _recent_turns_text(session)
    user = f"Contexte :\n{brief}\n\nÉchanges déjà confirmés :\n{turns or '(aucun)'}"
    parsed = _llm_json(_NEXT_SYSTEM, user, usage_context="context_guide:next", max_tokens=400)
    session["notice"] = ""
    session["question_fingerprint"] = _fingerprint()
    session["pending"] = None
    session["clarify_rounds"] = 0
    if not parsed:
        session["phase"] = "ask"
        session["current_question"] = NEXT_FALLBACK
        session["notice"] = "La prochaine question n'a pas pu être préparée. Vous pouvez préciser librement."
        _save_session(session)
        return _public_state(session)
    ask = _as_bool(parsed.get("ask"), True)
    question = _clip(parsed.get("question"), 400)
    if not ask or not question:
        session["phase"] = "hold"
        session["current_question"] = FREE_ADD_QUESTION
        _save_session(session)
        return _public_state(session)
    session["phase"] = "ask"
    session["current_question"] = question
    _save_session(session)
    return _public_state(session)


def submit_answer(answer: str) -> dict[str, Any]:
    text = (answer or "").strip()
    if not text:
        raise ValueError("La réponse est vide.")
    if len(text) > 4000:
        raise ValueError("La réponse est trop longue.")
    session = _load_session()
    if session["phase"] == "confirm":
        raise ValueError("Une proposition est en attente. Confirmez-la ou modifiez votre réponse.")
    question = session["current_question"] if session["phase"] == "ask" else FREE_ADD_QUESTION
    if len(text) < 12:
        return _ask_clarification(session, CLARIFY_FALLBACK)
    brief, _, _ = _context_parts()
    user = (
        f"Contexte déjà écrit :\n{brief}\n\n"
        f"Question posée :\n{question}\n\n"
        f"Réponse :\n{text}"
    )
    parsed = _llm_json(_INTERPRET_SYSTEM, user, usage_context="context_guide:interpret", max_tokens=900)
    vague = bool(parsed) and _as_bool(parsed.get("vague"), False)
    if vague and int(session.get("clarify_rounds") or 0) < 1:
        clarification = _clip(parsed.get("clarification"), 400) or CLARIFY_FALLBACK
        return _ask_clarification(session, clarification)
    proposal = _literal_proposal(text) if vague or not parsed else _sanitize_proposal(parsed, text)
    session["phase"] = "confirm"
    session["pending"] = {"question": question, "answer": text[:4000], "proposal": proposal}
    session["clarify_rounds"] = 0
    session["notice"] = ""
    _save_session(session)
    return _public_state(session)


def revise_answer() -> dict[str, Any]:
    session = _load_session()
    if session["phase"] != "confirm":
        raise ValueError("Aucune proposition à modifier.")
    question = ""
    if isinstance(session.get("pending"), dict):
        question = str(session["pending"].get("question") or "").strip()
    session["phase"] = "ask"
    session["pending"] = None
    session["notice"] = ""
    if question:
        session["current_question"] = question
    _save_session(session)
    return _public_state(session)


def _append_memory(memory: dict[str, str]) -> None:
    from database import get_enterprise_memory, merge_enterprise_contexts

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    merged: dict[str, str] = {}
    for key, fragment in memory.items():
        if key not in _MEMORY_KEYS:
            continue
        piece = fragment.strip()
        if not piece:
            continue
        prev = str(contexts.get(key) or "").strip()
        if piece.casefold() in prev.casefold():
            continue
        merged[key] = f"{prev}\n{piece}".strip() if prev else piece
    if merged:
        merge_enterprise_contexts(merged)


def _merge_entities(entities: list[dict[str, Any]]) -> None:
    from services.knowledge import get_entity, upsert_entity

    for item in entities:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        existing = get_entity(name)
        attributes = dict(item.get("attributes") or {})
        relations = {k: list(v) for k, v in (item.get("relations") or {}).items()}
        etype = str(item.get("entity_type") or "other")
        if existing:
            attributes = {**(existing.get("attributes") or {}), **attributes}
            prev_rels = existing.get("relations") if isinstance(existing.get("relations"), dict) else {}
            merged_rels: dict[str, list[str]] = {}
            for key in {**prev_rels, **relations}:
                bucket: list[str] = []
                raw_targets = prev_rels.get(key) if isinstance(prev_rels.get(key), list) else []
                new_targets = relations.get(key) if isinstance(relations.get(key), list) else []
                for target in list(raw_targets) + list(new_targets):
                    label = str(target or "").strip()
                    if label and label not in bucket:
                        bucket.append(label)
                if bucket:
                    merged_rels[str(key)] = bucket
            relations = merged_rels
            if not etype or etype == "other":
                etype = str(existing.get("entity_type") or etype)
        upsert_entity(name=name, entity_type=etype, attributes=attributes, relations=relations)


def confirm_pending() -> dict[str, Any]:
    session = _load_session()
    if session["phase"] != "confirm" or not isinstance(session.get("pending"), dict):
        raise ValueError("Aucune proposition à enregistrer.")
    pending = session["pending"]
    proposal = pending.get("proposal") if isinstance(pending.get("proposal"), dict) else None
    if not proposal:
        raise ValueError("Aucune proposition à enregistrer.")
    try:
        from database import snapshot_memory_history

        snapshot_memory_history(comment="auto — guide de contexte")
    except Exception:
        logger.exception("context guide snapshot failed")
    _append_memory(proposal.get("memory") if isinstance(proposal.get("memory"), dict) else {})
    facts = proposal.get("facts") if isinstance(proposal.get("facts"), dict) else {}
    if facts:
        from services.memory_inbox import merge_enterprise_facts

        merge_enterprise_facts(facts)
    entities = proposal.get("entities") if isinstance(proposal.get("entities"), list) else []
    if entities:
        _merge_entities(entities)
    session["turns"] = list(session.get("turns") or [])
    session["turns"].append(
        {
            "question": _clip(pending.get("question"), 400),
            "answer": _clip(pending.get("answer"), 800),
            "recorded": _clip(proposal.get("summary"), 800),
            "at": _now(),
        }
    )
    session["turns"] = session["turns"][-40:]
    session["pending"] = None
    return _set_next_question(session)


def dismiss_offer(offer_id: str) -> dict[str, Any]:
    key = (offer_id or "").strip()
    if not key:
        raise ValueError("Proposition inconnue.")
    session = _load_session()
    if _offer_by_id(session, key) is None:
        raise ValueError("Proposition inconnue.")
    dismissed = [item for item in session.get("dismissed") or [] if item != key]
    dismissed.append(key)
    session["dismissed"] = dismissed[-40:]
    _save_session(session)
    return _public_state(session)


def focus_offer(offer_id: str) -> dict[str, Any]:
    key = (offer_id or "").strip()
    session = _load_session()
    if session["phase"] == "confirm":
        raise ValueError("Confirmez ou modifiez la proposition en cours.")
    offer = _offer_by_id(session, key)
    if offer is None:
        raise ValueError("Proposition inconnue.")
    session["phase"] = "ask"
    session["current_question"] = offer["question"]
    session["pending"] = None
    session["notice"] = ""
    session["clarify_rounds"] = 0
    session["question_fingerprint"] = _fingerprint()
    session["view"] = "form"
    _save_session(session)
    return _public_state(session)


def open_form() -> dict[str, Any]:
    """Affiche seulement la question. Sans réponse confirmée, repart de la question neutre."""
    session = _load_session()
    if session["phase"] != "confirm" and not session.get("turns"):
        session["phase"] = "ask"
        session["current_question"] = OPENING_QUESTION
        session["pending"] = None
        session["notice"] = ""
        session["clarify_rounds"] = 0
    session["view"] = "form"
    _save_session(session)
    return _public_state(session)


def show_list() -> dict[str, Any]:
    """Revient à la liste. Une proposition non confirmée est écartée."""
    session = _load_session()
    if session["phase"] == "confirm":
        session["phase"] = "ask"
        session["pending"] = None
    session["view"] = "list"
    session["notice"] = ""
    _save_session(session)
    return _public_state(session)


def refresh_question() -> dict[str, Any]:
    session = _load_session()
    if session["phase"] == "confirm":
        raise ValueError("Confirmez ou modifiez la proposition en cours.")
    if not session.get("turns"):
        session["phase"] = "ask"
        session["current_question"] = OPENING_QUESTION
        session["pending"] = None
        session["notice"] = ""
        session["clarify_rounds"] = 0
        session["question_fingerprint"] = _fingerprint()
        _save_session(session)
        return _public_state(session)
    return _set_next_question(session)
