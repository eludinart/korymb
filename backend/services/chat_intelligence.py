"""Intelligence chat CIO : intent, ancrage déterministe, mémoire ciblée, brief."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from typing import Any

INTENT_CHAT = "chat"
INTENT_STATUS = "status"
INTENT_CRM = "crm"
INTENT_MEMORY = "memory"
INTENT_PLATFORM = "platform"
INTENT_MISSION = "mission"

_STATUS_RE = re.compile(
    r"\b("
    r"gmail|smtp|integration|sondes?|sante (systeme|korymb|app)|"
    r"ca marche|est[- ]ce que .{0,40}marche|fonctionne|"
    r"tickets? (hitl|d.action|decisions)|jobs? en erreur|"
    r"etat (de )?(korymb|l[' ]?app)|vue sante|overview|"
    r"web search|instagram|facebook"
    r")\b",
    re.I,
)
_PLATFORM_RE = re.compile(
    r"\b("
    r"bug|corrige|patch|spec plateforme|propose_platform|"
    r"bouton|composant|fichier \w+\.(py|tsx|ts)|fastapi|next\.js|"
    r"comportement moteur|sandbox_execute|lazy.?delegation"
    r")\b",
    re.I,
)
_MISSION_RE = re.compile(
    r"\b("
    r"lance (une )?mission|toute l[' ]?equipe|playbook|"
    r"approfondir (avec|en) mission|mission complete|"
    r"delegue (au|aux) (commercial|cm|developpeur|comptable)"
    r")\b",
    re.I,
)
_CRM_RE = re.compile(
    r"\b("
    r"contact|prospect|coach|devis|crm|planning|fiche|"
    r"client|relance|upsert"
    r")\b",
    re.I,
)
_MEMORY_RE = re.compile(
    r"^(?:memorise|mémorise|retiens|oublie|efface)\b",
    re.I,
)
_ACTION_RE = re.compile(
    r"\b(prepare|redige|trouve|produis|liste de|enquete|prospection)\b",
    re.I,
)

_STATUS_TOOLS = frozenset({"korymb_overview", "get_fleet_status"})
_CRM_TOOLS = frozenset({
    "gestion_search_contacts",
    "gestion_overview",
    "gestion_list_contacts",
    "gestion_list_quotes",
    "gestion_list_events",
    "korymb_overview",
})
_PLATFORM_TOOLS = frozenset({
    "search_core_notes",
    "propose_platform_change",
    "validate_syntax",
    "korymb_overview",
})

_CHAT_APPLY_STORE = "chat_apply_feedback"


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def classify_chat_intent(text: str) -> str:
    t = _fold(text)
    raw = (text or "").strip()
    if _MEMORY_RE.match(raw):
        return INTENT_MEMORY
    if _STATUS_RE.search(t):
        return INTENT_STATUS
    if _PLATFORM_RE.search(t):
        return INTENT_PLATFORM
    if _MISSION_RE.search(t):
        return INTENT_MISSION
    if _CRM_RE.search(t):
        return INTENT_CRM
    return INTENT_CHAT


def chat_message_needs_action(text: str) -> bool:
    """Vrai seulement si le message demande d'exécuter quelque chose (recherche, envoi, livrable)."""
    raw = (text or "").strip()
    if not raw:
        return False
    folded = _fold(raw)
    if re.search(
        r"\b(qui es[- ]tu|qui est[- ]tu|tu es qui|qui etes[- ]vous|presente[- ]toi|c'est qui)\b",
        folded,
    ):
        return False
    intent = classify_chat_intent(raw)
    if intent in {INTENT_MISSION, INTENT_PLATFORM}:
        return True
    if _ACTION_RE.search(folded):
        return True
    return bool(
        re.search(
            r"\b(cherche|chercher|recherche|rechercher|envoie|envoyer|lance|lancer|publie|publier|genere|generer|cree|creer|redige|ecris)\b",
            folded,
        )
    )


def extract_search_query(text: str) -> str:
    t = re.sub(r"^(est[- ]ce que|peux[- ]tu|peux tu|tu peux|dis[- ]moi)\s+", "", (text or "").strip(), flags=re.I)
    t = re.sub(r"[?!.]+$", "", t).strip()
    return t[:120]


def wants_mission_brief(intent: str, text: str) -> bool:
    if intent == INTENT_MISSION:
        return True
    if intent in {INTENT_STATUS, INTENT_MEMORY}:
        return False
    raw = (text or "").strip()
    if len(raw) >= 240 and _ACTION_RE.search(_fold(raw)):
        return True
    return False


def chat_tool_mandate(intent: str) -> str:
    if intent == INTENT_STATUS:
        return (
            "\n\n[Ancrage] Question d'état Korymb : appuie-toi UNIQUEMENT sur le bloc "
            "« Faits ancrés » (sondes / jobs). Interdit d'inventer qu'une intégration marche."
        )
    if intent == INTENT_CRM:
        return (
            "\n\n[Ancrage] Sujet CRM : utilise les faits Gestion fournis. "
            "Une création / mise à jour = proposition Décisions, pas une fiche déjà écrite."
        )
    if intent == INTENT_PLATFORM:
        return (
            "\n\n[Ancrage] Changement produit : appuie-toi sur les extraits docs/code. "
            "Propose via `propose_platform_change` ; n'affirme pas qu'un patch git est fait."
        )
    return ""


def chat_brief_mandate(intent: str, text: str) -> str:
    if not wants_mission_brief(intent, text):
        return ""
    return (
        "\n\n[Brief mission] Termine ta réponse par un bloc markdown prêt à lancer :\n"
        "## Objectif\n## Hors-périmètre\n## Livrables\n"
        "Sans ce bloc, le dirigeant ne peut pas convertir le chat en mission proprement."
    )


def tools_named_in_logs(job_logs: list[str] | None) -> set[str]:
    blob = "\n".join(job_logs or [])
    found: set[str] = set()
    for name in _STATUS_TOOLS | _CRM_TOOLS | _PLATFORM_TOOLS:
        if name in blob:
            found.add(name)
    return found


def logs_satisfy_grounding(intent: str, job_logs: list[str] | None, *, injected: bool) -> bool:
    if intent in {INTENT_CHAT, INTENT_MEMORY, INTENT_MISSION}:
        return True
    if injected:
        return True
    called = tools_named_in_logs(job_logs)
    if intent == INTENT_STATUS:
        return bool(called & _STATUS_TOOLS)
    if intent == INTENT_CRM:
        return bool(called & _CRM_TOOLS)
    if intent == INTENT_PLATFORM:
        return bool(called & _PLATFORM_TOOLS)
    return True


def record_chat_apply_feedback(*, title: str, kind: str, detail: str = "") -> None:
    from database import load_settings_store, save_settings_store

    data = load_settings_store(_CHAT_APPLY_STORE)
    items = list(data.get("items") or []) if isinstance(data, dict) else []
    items.insert(
        0,
        {
            "title": (title or "")[:160],
            "kind": (kind or "")[:48],
            "detail": (detail or "")[:240],
            "at": datetime.utcnow().isoformat(),
        },
    )
    save_settings_store(_CHAT_APPLY_STORE, {"items": items[:8]})


def load_chat_apply_feedback(limit: int = 4) -> list[dict[str, Any]]:
    from database import load_settings_store

    data = load_settings_store(_CHAT_APPLY_STORE)
    items = data.get("items") if isinstance(data, dict) else []
    if not isinstance(items, list):
        return []
    return [x for x in items if isinstance(x, dict)][:limit]


def _matching_memory_lines(user_text: str, global_ctx: str, *, max_lines: int = 4) -> str:
    tokens = [w for w in _fold(user_text).split() if len(w) > 3][:14]
    if not tokens or not global_ctx.strip():
        return ""
    scored: list[tuple[int, str]] = []
    for ln in global_ctx.splitlines():
        if not ln.strip():
            continue
        fold_ln = _fold(ln)
        score = sum(1 for t in tokens if t in fold_ln)
        if score:
            scored.append((score, ln.strip()))
    scored.sort(key=lambda x: -x[0])
    lines = [ln for _, ln in scored[:max_lines]]
    return "\n".join(lines)


def build_targeted_memory_block(user_text: str) -> str:
    from services.memory_inbox import MEMORY_CHAT_GLOBAL_CHARS, MEMORY_CHAT_SUMMARY_CHARS
    from database import get_enterprise_memory

    mem = get_enterprise_memory()
    contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
    parts: list[str] = []
    try:
        from services.memory_inbox import format_enterprise_facts_prompt

        facts_blk = format_enterprise_facts_prompt(max_chars=500)
        if facts_blk:
            parts.append(facts_blk)
    except Exception:
        pass
    matched = _matching_memory_lines(user_text, str(contexts.get("global") or ""))
    if matched:
        parts.append("Faits mémoire liés à la question :\n" + matched[:MEMORY_CHAT_GLOBAL_CHARS])
    else:
        global_ctx = str(contexts.get("global") or "").strip()
        if global_ctx:
            parts.append("Contexte global (extrait) :\n" + global_ctx[: min(220, MEMORY_CHAT_GLOBAL_CHARS)])
    summary = str(contexts.get("auto_summary") or "").strip()
    if summary:
        parts.append("Résumé missions :\n" + summary[:MEMORY_CHAT_SUMMARY_CHARS])
    fb = load_chat_apply_feedback(limit=3)
    if fb:
        lines = [f"- {x.get('kind')}: {x.get('title')}" for x in fb if x.get("title")]
        if lines:
            parts.append("Récemment validé dans Décisions :\n" + "\n".join(lines))
    if not parts:
        return ""
    return (
        "\n\n[Mémoire active — usage interne silencieux, ne pas réciter en checklist]\n"
        + "\n".join(parts)
    )


def build_chat_grounding_block(user_text: str, *, intent: str | None = None) -> str:
    """Appelle les outils lecture seule selon l'intent — faits à coller dans le prompt CIO."""
    intent = intent or classify_chat_intent(user_text)
    chunks: list[str] = []
    q = extract_search_query(user_text)

    if intent == INTENT_STATUS:
        try:
            from services.korymb_overview import build_korymb_overview

            chunks.append(build_korymb_overview())
        except Exception:
            chunks.append("(overview Korymb indisponible)")
    elif intent == INTENT_CRM:
        try:
            from services.business_db import get_business_overview, search_contacts

            stats = get_business_overview()
            chunks.append("Stats Gestion : " + json.dumps(stats, ensure_ascii=False))
            if q:
                hits = search_contacts(q, limit=8)
                slim = [
                    {
                        "name": h.get("name"),
                        "email": h.get("email"),
                        "company": h.get("company"),
                        "city": h.get("city"),
                    }
                    for h in (hits or [])[:8]
                    if isinstance(h, dict)
                ]
                chunks.append("Recherche contacts : " + json.dumps(slim, ensure_ascii=False))
        except Exception:
            chunks.append("(CRM lecture indisponible)")
    elif intent == INTENT_PLATFORM:
        try:
            from tools.agent_tools import search_core_notes

            qn = q or "korymb architecture"
            chunks.append(search_core_notes(qn, max_results=5, include_code=True))
        except Exception:
            chunks.append("(notes / code indisponibles)")

    if not chunks:
        return ""
    return "### Faits ancrés (ne pas contredire, ne pas inventer par-dessus)\n" + "\n\n".join(chunks)
