"""Boucle d'apprentissage post-validation mission."""
from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)


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
        memory_keys["derniere_mission_validee"] = mission[:500]
    return {
        "title": f"Apprentissage — {mission[:80] or job.get('id', '')}",
        "learnings": learnings,
        "suggested_memory_keys": memory_keys,
        "suggested_prompt_tweaks": [],
    }


def trigger_learning_on_validate(job_id: str) -> dict | None:
    """Crée une suggestion d'apprentissage pending après validation dirigeant."""
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
    try:
        from services.director_platform import emit_director_notification

        emit_director_notification(
            kind="learning_suggestion",
            title=str(payload.get("title") or "Suggestion d'apprentissage"),
            body="Nouvelle suggestion à approuver depuis l'inbox.",
            job_id=job_id,
            action_url=f"/inbox?job={job_id}",
        )
    except Exception:
        logger.exception("Director notification for learning failed")
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
