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
        "drive_workspace",
        "enterprise_facts",
        "memory_compacted_at",
    }
)


def _heuristic_learning(job: dict) -> dict:
    mission = str(job.get("mission") or "").strip()
    result = str(job.get("result") or "").strip()
    learnings: list[str] = []
    if mission:
        learnings.append(f"Mission validée : {mission[:200]}")
    if len(result) > 120:
        learnings.append(f"Livrable clé : {result[:280]}…")
    memory_keys: dict[str, str] = {}
    if mission and len(mission) > 20:
        memory_keys["global"] = f"Dernière mission validée : {mission[:500]}"
    return {
        "title": f"Apprentissage — {mission[:80] or job.get('id', '')}",
        "learnings": learnings,
        "suggested_memory_keys": memory_keys,
        "suggested_prompt_tweaks": [],
    }


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

    tweaks = payload.get("suggested_prompt_tweaks") if isinstance(payload.get("suggested_prompt_tweaks"), list) else []
    if tweaks:
        return False, "prompt_tweaks"

    memory_updates = payload.get("suggested_memory_keys") if isinstance(payload.get("suggested_memory_keys"), dict) else {}
    facts = payload.get("enterprise_facts") if isinstance(payload.get("enterprise_facts"), dict) else None
    if not memory_updates and not facts:
        return False, "no_memory_updates"

    # Brand kit vitrine : données déjà saisies par le dirigeant → auto en safe/full
    source = str(payload.get("source") or "").strip()
    if source == "chat_directive":
        return False, "chat_directive"
    if payload.get("memory_directive"):
        return False, "memory_directive"
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
            payload = _llm_extract_learning(row) or payload
        except Exception:
            logger.exception("LLM learning extraction failed for %s", job_id)
    sug = propose_memory_suggestion(
        title=str(payload.get("title") or "Apprentissage mission"),
        learnings=payload.get("learnings") if isinstance(payload.get("learnings"), list) else [],
        suggested_memory_keys=payload.get("suggested_memory_keys")
        if isinstance(payload.get("suggested_memory_keys"), dict)
        else {},
        suggested_prompt_tweaks=payload.get("suggested_prompt_tweaks")
        if isinstance(payload.get("suggested_prompt_tweaks"), list)
        else [],
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


def _llm_extract_learning(job: dict) -> dict | None:
    from llm_client import llm_turn

    mission = str(job.get("mission") or "")[:1500]
    result = str(job.get("result") or "")[:3000]
    prompt = (
        "Extrais des apprentissages actionnables pour la mémoire entreprise.\n"
        f"Mission:\n{mission}\n\nRésultat:\n{result}\n\n"
        "Réponds UNIQUEMENT en JSON:\n"
        '{"title":"...","learnings":["..."],"suggested_memory_keys":{"cle":"valeur"},'
        '"suggested_prompt_tweaks":["..."]}'
    )
    text, _, _ = llm_turn(prompt, max_tokens=800, or_profile="lite", usage_context="learning:validate")
    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        return None
    data = json.loads(text[start:end])
    if not isinstance(data, dict):
        return None
    return {
        "title": str(data.get("title") or "")[:160],
        "learnings": data.get("learnings") if isinstance(data.get("learnings"), list) else [],
        "suggested_memory_keys": data.get("suggested_memory_keys")
        if isinstance(data.get("suggested_memory_keys"), dict)
        else {},
        "suggested_prompt_tweaks": data.get("suggested_prompt_tweaks")
        if isinstance(data.get("suggested_prompt_tweaks"), list)
        else [],
    }
