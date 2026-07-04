"""Boucle d'apprentissage post-validation mission."""
from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

_SAFE_AUTO_APPLY_MAX_CHARS = 800
_FULL_AUTO_APPLY_MAX_CHARS = 2000
_SYSTEM_MEMORY_KEYS = frozenset({"auto_summary", "auto_summary_updated_at", "drive_workspace"})


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
    if not memory_updates:
        return False, "no_memory_updates"

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
    from database import merge_enterprise_contexts, snapshot_memory_history

    memory_updates = payload.get("suggested_memory_keys") if isinstance(payload.get("suggested_memory_keys"), dict) else {}
    normalized = normalize_learning_memory_updates(memory_updates)
    if not normalized:
        return {}
    snapshot_memory_history(comment=snapshot_comment)
    merge_enterprise_contexts(normalized)
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
    from database import get_job, insert_learning_suggestion

    row = get_job(job_id)
    if not row:
        return None
    payload = _heuristic_learning(row)
    if os.getenv("ENV") != "test":
        try:
            payload = _llm_extract_learning(row) or payload
        except Exception:
            logger.exception("LLM learning extraction failed for %s", job_id)
    sug = insert_learning_suggestion(job_id, payload)
    sid = str(sug.get("id") or "")
    auto_applied = try_auto_apply_learning(sid, payload) if sid else False
    try:
        from services.director_platform import emit_director_notification

        if auto_applied:
            emit_director_notification(
                kind="learning_suggestion",
                title=str(payload.get("title") or "Apprentissage appliqué"),
                body="Suggestion mémoire appliquée automatiquement (mode apprentissage).",
                job_id=job_id,
                action_url=f"/administration/memory",
            )
        else:
            emit_director_notification(
                kind="learning_suggestion",
                title=str(payload.get("title") or "Suggestion d'apprentissage"),
                body="Nouvelle suggestion à approuver depuis l'inbox.",
                job_id=job_id,
                action_url=f"/inbox?job={job_id}",
            )
    except Exception:
        logger.exception("Director notification for learning failed")
    try:
        from services.config_suggestions import scan_config_suggestions

        scan_config_suggestions(job_id=job_id)
    except Exception:
        logger.exception("config_suggestions scan after validate failed for %s", job_id)
    if auto_applied and isinstance(sug, dict):
        sug = dict(sug)
        sug["status"] = "auto_applied"
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
