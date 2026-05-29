"""Garde-fou qualité avant clôture mission."""
from __future__ import annotations

import logging

from database import get_behavior_setting, insert_quality_verdict, list_quality_verdicts

logger = logging.getLogger(__name__)


def _min_score_threshold() -> float:
    from services.behavior_defaults import behavior_default_value

    raw = get_behavior_setting("quality.min_score_to_complete")
    if raw is None:
        raw = behavior_default_value("quality.min_score_to_complete")
    try:
        return float(raw or 0)
    except (TypeError, ValueError):
        return 0.0


def _heuristic_score(result: str) -> float:
    text = (result or "").strip()
    if not text:
        return 0.0
    if "erreur" in text.lower()[:200] or "échec" in text.lower()[:200]:
        return 2.0
    score = min(10.0, 3.0 + len(text) / 400.0)
    return round(score, 2)


def assess_and_record(job_id: str, *, result: str, phase: str = "completion") -> dict:
    score = _heuristic_score(result)
    rejected = False
    min_score = _min_score_threshold()
    if min_score > 0 and score < min_score:
        rejected = True
    row = insert_quality_verdict(
        job_id,
        phase=phase,
        score=score,
        rejected=rejected,
        payload={"min_score": min_score, "result_chars": len(result or "")},
    )
    return row


def should_block_completion(job_id: str, score: float) -> bool:
    min_score = _min_score_threshold()
    if min_score <= 0:
        return False
    overrides = [v for v in list_quality_verdicts(job_id) if str(v.get("phase") or "") == "override"]
    if overrides:
        return False
    return score < min_score


def notify_quality_alert(job_id: str, score: float) -> None:
    try:
        from services.director_platform import emit_director_notification

        emit_director_notification(
            kind="quality",
            title=f"Qualité insuffisante — mission {job_id}",
            body=f"Score {score}/10 sous le seuil configuré.",
            job_id=job_id,
            action_url=f"/missions?job={job_id}",
        )
    except Exception:
        logger.exception("Quality notification failed for %s", job_id)
