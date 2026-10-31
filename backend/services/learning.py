"""Boucle d'apprentissage post-validation mission."""
from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

_SAFE_AUTO_APPLY_MAX_CHARS = 800
_FULL_AUTO_APPLY_MAX_CHARS = 2000
_SYSTEM_MEMORY_KEYS = frozenset(
    {
        "auto_summary",
        "auto_summary_updated_at",
        "auto_summary_mode",
        "auto_summary_manual",
        "drive_workspace",
        "enterprise_facts",
        "memory_compacted_at",
    }
)


def _is_chat_job(job: dict) -> bool:
    return str(job.get("source") or "").strip().lower().startswith("chat")


def _heuristic_learning(job: dict) -> dict:
    """Repli sans LLM : n'écrit plus de « Dernière mission validée » (bruit, pas science)."""
    mission = str(job.get("mission") or "").strip()
    title_src = mission.splitlines()[0].strip() if mission else str(job.get("id") or "")
    # Chat : sans extraction LLM on ne pollue pas la mémoire globale.
    if _is_chat_job(job):
        return {
            "title": f"Science — {title_src[:80]}",
            "learnings": [],
            "suggested_memory_keys": {},
            "suggested_prompt_tweaks": [],
            "enterprise_facts": {},
        }
    learnings: list[str] = []
    if mission and len(mission) > 40:
        learnings.append(f"Mission traitée : {mission[:200]}")
    result = str(job.get("result") or "").strip()
    if len(result) > 160:
        learnings.append(f"Livrable notable : {result[:240]}…")
    return {
        "title": f"Science — {title_src[:80] or job.get('id', '')}",
        "learnings": learnings,
        "suggested_memory_keys": {},
        "suggested_prompt_tweaks": [],
        "enterprise_facts": {},
    }


def _clip_memory_keys_for_auto_apply(keys: dict[str, str], *, max_chars: int | None = None) -> dict[str, str]:
    """Garde chaque volet sous le plafond safe pour ne pas bloquer l'auto-apply."""
    limit = max_chars if max_chars is not None else _SAFE_AUTO_APPLY_MAX_CHARS
    out: dict[str, str] = {}
    for k, v in keys.items():
        text = str(v or "").strip()
        if not text:
            continue
        if len(text) > limit:
            text = text[: max(0, limit - 1)].rstrip() + "…"
        out[str(k)] = text
    return out


def _sanitize_enterprise_facts(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    allowed = (
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
    )
    out: dict = {}
    for key in allowed:
        if key not in raw:
            continue
        val = raw[key]
        if isinstance(val, list):
            clean = [str(x).strip()[:120] for x in val if str(x or "").strip()][:12]
            if clean:
                out[key] = clean
        else:
            text = str(val or "").strip()
            if text:
                out[key] = text[:500]
    return out


def get_learning_auto_apply_mode() -> str:
    from database import get_behavior_setting
    from services.behavior_defaults import behavior_default_value

    raw = get_behavior_setting("learning.auto_apply_mode")
    if raw is None:
        raw = behavior_default_value("learning.auto_apply_mode")
    mode = str(raw or "safe").strip().lower()
    return mode if mode in {"off", "safe", "full"} else "safe"


def normalize_learning_memory_updates(memory_updates: dict) -> dict[str, str]:
    """Mappe les clés inconnues vers global et fusionne avec le contexte existant."""
    from database import _memory_context_allowed_keys, get_enterprise_memory

    allowed = _memory_context_allowed_keys()
    cur = get_enterprise_memory()
    contexts = cur.get("contexts") if isinstance(cur.get("contexts"), dict) else {}
    out: dict[str, str] = {}
    for k, v in memory_updates.items():
        val = str(v).strip()
        if not val:
            continue
        key = str(k) if str(k) in allowed else "global"
        prev = str(contexts.get(key) or "").strip()
        if key in out:
            out[key] = f"{out[key]}\n{val}".strip()
        elif prev:
            out[key] = f"{prev}\n{val}".strip()
        else:
            out[key] = val
    return out


def can_auto_apply_learning(payload: dict, *, mode: str | None = None) -> tuple[bool, str]:
    """Évalue si une suggestion peut être appliquée sans validation humaine."""
    apply_mode = (mode or get_learning_auto_apply_mode()).strip().lower()
    if apply_mode == "off":
        return False, "mode_off"

    # Les tweaks de prompts ne bloquent plus l'auto-apply mémoire (ignorés à l'écriture).
    memory_updates = payload.get("suggested_memory_keys") if isinstance(payload.get("suggested_memory_keys"), dict) else {}
    facts = payload.get("enterprise_facts") if isinstance(payload.get("enterprise_facts"), dict) else None
    directive = payload.get("memory_directive") if isinstance(payload.get("memory_directive"), dict) else None

    # Oublis / suppressions : toujours HITL. « Mémorise » explicite : auto en safe/full.
    if directive:
        action = str(directive.get("action") or "").strip()
        if action in {"forget_all", "forget_phrase"}:
            return False, "memory_directive_forget"
        if action == "remember" and apply_mode in {"safe", "full"}:
            detail = str(directive.get("detail") or "").strip()
            if not detail and not memory_updates:
                return False, "no_memory_updates"
            return True, "ok"
        return False, "memory_directive"

    if not memory_updates and not facts:
        return False, "no_memory_updates"

    # Brand kit vitrine : données déjà saisies par le dirigeant → auto en safe/full
    source = str(payload.get("source") or "").strip()
    if source == "storefront_sync" and apply_mode in {"safe", "full"}:
        return True, "ok"

    from database import _memory_context_allowed_keys

    allowed = _memory_context_allowed_keys()
    max_len = _FULL_AUTO_APPLY_MAX_CHARS if apply_mode == "full" else _SAFE_AUTO_APPLY_MAX_CHARS

    for k, v in memory_updates.items():
        key = str(k) if str(k) in allowed else "global"
        if key in _SYSTEM_MEMORY_KEYS:
            return False, "system_key"
        if apply_mode == "safe" and key not in allowed:
            return False, "unknown_key"
        if len(str(v).strip()) > max_len:
            return False, "too_long"

    return True, "ok"


def resolve_learning_decision(suggestion_id: str, decision: str) -> dict | None:
    """Approuve (applique mémoire) ou rejette une suggestion. Retourne la ligne à jour."""
    from database import get_learning_suggestion, resolve_learning_suggestion

    sug = get_learning_suggestion(suggestion_id)
    if not sug:
        return None
    if decision == "approve":
        payload = sug.get("payload") if isinstance(sug.get("payload"), dict) else {}
        memory_updates = (
            payload.get("suggested_memory_keys") if isinstance(payload.get("suggested_memory_keys"), dict) else {}
        )
        directive = payload.get("memory_directive") if isinstance(payload.get("memory_directive"), dict) else None
        facts = payload.get("enterprise_facts") if isinstance(payload.get("enterprise_facts"), dict) else None
        if memory_updates or directive or facts:
            apply_learning_payload_to_memory(
                payload if isinstance(payload, dict) else {},
                snapshot_comment="auto — learning suggestion approved",
            )
        try:
            from services.chat_intelligence import record_chat_apply_feedback

            record_chat_apply_feedback(
                title=str(payload.get("title") or "Mémoire"),
                kind="memory",
                detail=str((payload.get("memory_directive") or {}).get("detail") or "")[:240],
            )
        except Exception:
            pass
        resolve_learning_suggestion(suggestion_id, "approved")
    else:
        resolve_learning_suggestion(suggestion_id, "rejected")
    try:
        from database import mark_notifications_read_by_suggestion

        mark_notifications_read_by_suggestion(suggestion_id)
    except Exception:
        logger.exception("mark memory notification read failed for %s", suggestion_id)
    return get_learning_suggestion(suggestion_id)


def resolve_learning_bulk(*, decision: str, limit: int = 40) -> dict:
    """Traite en masse les suggestions mémoire pending (approve|reject)."""
    from database import list_learning_suggestions

    if decision not in {"approve", "reject"}:
        raise ValueError("decision must be approve or reject")
    pending = list_learning_suggestions(status="pending", limit=max(1, min(int(limit or 40), 100)))
    resolved: list[str] = []
    errors: list[dict[str, str]] = []
    for sug in pending:
        sid = str(sug.get("id") or "").strip()
        if not sid:
            continue
        try:
            out = resolve_learning_decision(sid, decision)
            if out:
                resolved.append(sid)
            else:
                errors.append({"id": sid, "error": "not_found"})
        except Exception as exc:
            logger.exception("resolve_learning_bulk failed for %s", sid)
            errors.append({"id": sid, "error": str(exc)[:200]})
    return {
        "ok": True,
        "decision": decision,
        "resolved": resolved,
        "resolved_count": len(resolved),
        "errors": errors,
        "error_count": len(errors),
    }


def apply_learning_payload_to_memory(payload: dict, *, snapshot_comment: str) -> dict[str, str]:
    from database import (
        delete_enterprise_context_keys,
        get_enterprise_memory,
        merge_enterprise_contexts,
        snapshot_memory_history,
    )

    directive = payload.get("memory_directive") if isinstance(payload.get("memory_directive"), dict) else None
    if directive:
        action = str(directive.get("action") or "").strip()
        key = str(directive.get("key") or "global").strip() or "global"
        detail = str(directive.get("detail") or "").strip()
        snapshot_memory_history(comment=snapshot_comment)
        if action == "forget_all":
            delete_enterprise_context_keys([key])
            return {key: ""}
        if action == "forget_phrase":
            cur = get_enterprise_memory()
            prev = ""
            if isinstance(cur.get("contexts"), dict):
                prev = str(cur["contexts"].get(key) or "")
            needle = detail.casefold()
            kept = [ln for ln in prev.splitlines() if needle not in ln.casefold()]
            new_val = "\n".join(kept).strip()
            merge_enterprise_contexts({key: new_val})
            return {key: new_val}
        if action == "remember" and detail:
            memory_updates = {key: f"- {detail}"}
        else:
            memory_updates = {}
    else:
        memory_updates = payload.get("suggested_memory_keys") if isinstance(payload.get("suggested_memory_keys"), dict) else {}

    normalized = normalize_learning_memory_updates(memory_updates) if memory_updates else {}
    facts = payload.get("enterprise_facts") if isinstance(payload.get("enterprise_facts"), dict) else None
    if not normalized and not facts:
        return {}
    if not directive:
        snapshot_memory_history(comment=snapshot_comment)
    if normalized:
        merge_enterprise_contexts(normalized)
    if facts:
        try:
            from services.memory_inbox import merge_enterprise_facts

            merge_enterprise_facts(facts)
        except Exception:
            logger.exception("merge_enterprise_facts during learning apply failed")
    try:
        from services.memory_inbox import maybe_compact_on_memory_touch

        maybe_compact_on_memory_touch()
    except Exception:
        logger.exception("compaction after learning apply failed")
    return normalized


def try_auto_apply_learning(suggestion_id: str, payload: dict) -> bool:
    ok, _reason = can_auto_apply_learning(payload)
    if not ok:
        return False
    try:
        apply_learning_payload_to_memory(
            payload,
            snapshot_comment="auto — learning auto-applied",
        )
        from database import resolve_learning_suggestion

        resolve_learning_suggestion(suggestion_id, "auto_applied")
        return True
    except Exception:
        logger.exception("try_auto_apply_learning failed for %s", suggestion_id)
        return False


def trigger_learning_on_validate(job_id: str) -> dict | None:
    """Crée une suggestion d'apprentissage ; applique automatiquement si le mode le permet."""
    from database import get_job
    from services.memory_inbox import propose_memory_suggestion

    row = get_job(job_id)
    if not row:
        return None
    payload = _heuristic_learning(row)
    if os.getenv("ENV") != "test":
        try:
            extracted = _llm_extract_learning(row)
            if extracted and (
                extracted.get("suggested_memory_keys")
                or extracted.get("enterprise_facts")
                or extracted.get("learnings")
            ):
                payload = extracted
        except Exception:
            logger.exception("LLM learning extraction failed for %s", job_id)
    keys = (
        payload.get("suggested_memory_keys")
        if isinstance(payload.get("suggested_memory_keys"), dict)
        else {}
    )
    facts = (
        payload.get("enterprise_facts")
        if isinstance(payload.get("enterprise_facts"), dict)
        else {}
    )
    keys = _clip_memory_keys_for_auto_apply(keys)
    facts = _sanitize_enterprise_facts(facts)
    if not keys and not facts:
        return None
    sug = propose_memory_suggestion(
        title=str(payload.get("title") or "Science entreprise"),
        learnings=payload.get("learnings") if isinstance(payload.get("learnings"), list) else [],
        suggested_memory_keys=keys,
        suggested_prompt_tweaks=payload.get("suggested_prompt_tweaks")
        if isinstance(payload.get("suggested_prompt_tweaks"), list)
        else [],
        enterprise_facts=facts or None,
        source="mission_validate",
        job_id=job_id,
        source_ref=job_id,
        notify=True,
    )
    try:
        from services.config_suggestions import scan_config_suggestions

        scan_config_suggestions(job_id=job_id)
    except Exception:
        logger.exception("config_suggestions scan after validate failed for %s", job_id)
    return sug


def _existing_science_snapshot(*, max_chars: int = 1800) -> str:
    """Contexte déjà connu — pour enrichir sans répéter."""
    parts: list[str] = []
    try:
        from database import get_enterprise_memory

        mem = get_enterprise_memory()
        contexts = mem.get("contexts") if isinstance(mem.get("contexts"), dict) else {}
        global_ctx = str(contexts.get("global") or "").strip()
        if global_ctx:
            parts.append("Contexte global actuel :\n" + global_ctx[:900])
    except Exception:
        pass
    try:
        from services.memory_inbox import format_enterprise_facts_prompt

        facts_blk = format_enterprise_facts_prompt(max_chars=500)
        if facts_blk:
            parts.append(facts_blk)
    except Exception:
        pass
    text = "\n\n".join(parts).strip()
    if len(text) > max_chars:
        return text[: max_chars - 1].rstrip() + "…"
    return text


def _llm_extract_learning(job: dict) -> dict | None:
    """Extrait une science d'entreprise riche (faits + mémoire), pas un écho de mission."""
    from llm_client import llm_turn

    mission = str(job.get("mission") or "")[:3500]
    result = str(job.get("result") or "")[:2500]
    if not mission.strip() and not result.strip():
        return None
    existing = _existing_science_snapshot()
    chat_note = (
        "Source = chat dirigeant : le message utilisateur est la source de vérité "
        "(identité, organisation, actifs, offres). La réponse assistant n'est qu'un appui. "
        "Ignore le méta Korymb (flotte, HITL, boutons, questionnaires).\n"
        if _is_chat_job(job)
        else "Source = mission : tire les faits durables du brief et du livrable.\n"
    )
    prompt = (
        "Tu enrichis la SCIENCE D'ENTREPRISE d'un espace Korymb.\n"
        "Objectif : capturer au maximum ce qui aide à connaître l'activité réelle "
        "(qui, quoi, où, comment, pour qui, avec quels actifs), de façon durable.\n"
        f"{chat_note}"
        "Sois prolifique sur les faits métier utiles, mais judicieux : "
        "pas de reformulation vide, pas de conseils, pas de processus UI, "
        "pas de « dernière mission validée », pas de secrets (mots de passe, clés).\n"
        "N'invente rien. Ne répète pas ce qui est déjà dans la science connue "
        "(sauf précision nouvelle).\n\n"
        f"Science déjà connue (ne pas redire) :\n{existing or '(vide)'}\n\n"
        f"Message / mission :\n{mission or '(vide)'}\n\n"
        f"Réponse / livrable :\n{result or '(vide)'}\n\n"
        "Réponds UNIQUEMENT en JSON valide :\n"
        "{\n"
        '  "title": "Science — …",\n'
        '  "learnings": ["fait durable 1", "fait 2", "... jusqu\'à 10"],\n'
        '  "suggested_memory_keys": {\n'
        '    "global": "- puces activité, organisation, actifs, géographie (max ~700 car.)",\n'
        '    "commercial": "- offres, clients cibles, canaux (si pertinent)",\n'
        '    "comptable": "- structure juridique / sociétés (si pertinent)"\n'
        "  },\n"
        '  "enterprise_facts": {\n'
        '    "brand": "nom commercial",\n'
        '    "activity": "activité en une phrase",\n'
        '    "location": "lieu",\n'
        '    "offers": ["offre1", "offre2"],\n'
        '    "companies": ["raison sociale 1"],\n'
        '    "assets": ["bateau / lieu / outil"],\n'
        '    "org": "structure / personnes clés",\n'
        '    "icp": "clients types",\n'
        '    "tone": "ton relationnel si dit"\n'
        "  },\n"
        '  "suggested_prompt_tweaks": []\n'
        "}\n"
        "Omets les clés vides. Chaque valeur de suggested_memory_keys ≤ 700 caractères. "
        "Préfère des puces « - … » concrètes.\n"
    )
    text, _, _ = llm_turn(
        prompt,
        max_tokens=1600,
        or_profile="standard",
        usage_context="learning:science_extract",
    )
    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(text[start:end])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    raw_keys = data.get("suggested_memory_keys") if isinstance(data.get("suggested_memory_keys"), dict) else {}
    # Filtre les échos de mission / méta chat.
    clean_keys: dict[str, str] = {}
    for k, v in raw_keys.items():
        val = str(v or "").strip()
        if not val:
            continue
        fold = val.casefold()
        if fold.startswith("dernière mission validée") or fold.startswith("derniere mission validee"):
            continue
        if _is_chat_job(job) and all(tok in fold for tok in ("korymb", "flotte")) and len(val) < 120:
            continue
        clean_keys[str(k)] = val
    learnings = []
    if isinstance(data.get("learnings"), list):
        for item in data["learnings"][:12]:
            line = str(item or "").strip()
            if line and not line.casefold().startswith("mission validée"):
                learnings.append(line[:280])
    facts = _sanitize_enterprise_facts(data.get("enterprise_facts"))
    if not clean_keys and not facts and not learnings:
        return None
    # Si uniquement des learnings : les pousser en global.
    if not clean_keys and learnings:
        clean_keys["global"] = "\n".join(f"- {x}" for x in learnings[:8])
    return {
        "title": str(data.get("title") or "Science entreprise")[:160],
        "learnings": learnings,
        "suggested_memory_keys": _clip_memory_keys_for_auto_apply(clean_keys),
        "suggested_prompt_tweaks": data.get("suggested_prompt_tweaks")
        if isinstance(data.get("suggested_prompt_tweaks"), list)
        else [],
        "enterprise_facts": facts,
    }


def chat_message_looks_like_science(message: str) -> bool:
    """Heuristique légère : message assez riche pour enrichir l'entreprise."""
    text = (message or "").strip()
    if len(text) < 80:
        return False
    fold = text.casefold()
    skip = (
        "bonjour",
        "salut",
        "merci",
        "ok ",
        "okay",
        "qui es-tu",
        "reformule",
        "plus court",
        "continue",
    )
    if any(fold.startswith(s) for s in skip) and len(text) < 160:
        return False
    signals = (
        "entreprise",
        "société",
        "societe",
        "activité",
        "activite",
        "client",
        "offre",
        "bateau",
        "organisation",
        "je suis",
        "nous sommes",
        "mon ",
        "ma ",
        "sasu",
        "ei ",
        "gîte",
        "gite",
        "ferme",
        "cabinet",
        "coach",
        "var",
        "tourves",
    )
    if any(s in fold for s in signals):
        return True
    return len(text) >= 220


def maybe_capture_science_from_chat(
    user_message: str,
    assistant_reply: str = "",
) -> dict | None:
    """
    Enrichit la science après un tour de Discussion (sans jargon mission).
    Retourne un résumé UI ou None si rien à retenir.
    """
    if os.getenv("ENV") == "test":
        return None
    if not chat_message_looks_like_science(user_message):
        return None
    job = {
        "id": "chat-science",
        "source": "chat",
        "mission": (user_message or "")[:3500],
        "result": (assistant_reply or "")[:2000],
    }
    try:
        payload = _llm_extract_learning(job)
    except Exception:
        logger.exception("maybe_capture_science_from_chat extract failed")
        return None
    if not payload:
        return None
    keys = (
        payload.get("suggested_memory_keys")
        if isinstance(payload.get("suggested_memory_keys"), dict)
        else {}
    )
    facts = _sanitize_enterprise_facts(payload.get("enterprise_facts"))
    keys = _clip_memory_keys_for_auto_apply(keys)
    if not keys and not facts:
        return None
    from services.memory_inbox import propose_memory_suggestion

    sug = propose_memory_suggestion(
        title=str(payload.get("title") or "Science — conversation")[:160],
        learnings=payload.get("learnings") if isinstance(payload.get("learnings"), list) else [],
        suggested_memory_keys=keys,
        enterprise_facts=facts or None,
        source="chat_science",
        job_id="",
        source_ref="chat",
        notify=False,
        allow_auto_apply=True,
    )
    bullets: list[str] = []
    if isinstance(payload.get("learnings"), list):
        for item in payload["learnings"][:6]:
            line = str(item or "").strip()
            if line:
                bullets.append(line[:160])
    if not bullets:
        for val in keys.values():
            for ln in str(val).splitlines():
                clean = ln.strip().lstrip("-• ").strip()
                if clean:
                    bullets.append(clean[:160])
                if len(bullets) >= 6:
                    break
            if len(bullets) >= 6:
                break
    if not bullets and facts:
        for k, v in list(facts.items())[:6]:
            if isinstance(v, list):
                bullets.append(f"{k}: {', '.join(str(x) for x in v[:4])}")
            else:
                bullets.append(f"{k}: {v}")
    if not bullets:
        return None
    applied = bool(sug and str(sug.get("status") or "") == "auto_applied")
    return {
        "title": "J’ai retenu pour ton entreprise",
        "bullets": bullets[:6],
        "applied": applied,
        "suggestion_id": str((sug or {}).get("id") or ""),
        "href": "/gestion/science",
    }
