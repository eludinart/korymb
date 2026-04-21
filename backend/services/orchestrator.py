"""
services/orchestrator.py — Orchestration de missions : peer review, HITL gate.

Implémente le protocole HITL (Human-In-The-Loop) complet :
- prepare_hitl_gate : suspend le job et prépare l'enveloppe de validation
- resume_hitl_gate  : reprend ou annule le job après décision humaine
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from services.notifications import queue_hitl_validation

logger = logging.getLogger(__name__)


class PeerReviewTask(BaseModel):
    agent: str = Field(min_length=2, max_length=64)
    task: str = Field(min_length=3, max_length=4000)
    depends_on: str | None = None


class PeerReviewPlan(BaseModel):
    mission: str = Field(min_length=3, max_length=6000)
    tasks: list[PeerReviewTask]
    mode: str = "peer_review"


def build_peer_review_plan(*, mission: str, primary_agent: str, devil_advocate_agent: str) -> PeerReviewPlan:
    mission_clean = mission.strip()
    return PeerReviewPlan(
        mission=mission_clean,
        tasks=[
            PeerReviewTask(agent=primary_agent, task=f"Resultat: produire le livrable principal pour '{mission_clean}'."),
            PeerReviewTask(
                agent=devil_advocate_agent,
                task="Validation: contredire, verifier les angles morts, risques et incoherences.",
                depends_on=primary_agent,
            ),
        ],
    )


def prepare_hitl_gate(
    *,
    job_id: str,
    mission: str,
    result_preview: str,
    reviewer: str = "human_operator",
) -> dict[str, Any]:
    """
    Prépare une pause HITL pour le job spécifié.
    Met le job en statut 'awaiting_validation' et retourne l'enveloppe de gate.

    Returns:
        Enveloppe HITL avec status, job_id, payload.
    """
    gate_payload: dict[str, Any] = {
        "job_id": job_id,
        "mission": (mission or "")[:800],
        "result_preview": (result_preview or "")[:2000],
        "reviewer": (reviewer or "human_operator")[:120],
    }

    # Mise à jour du statut en base
    gate_persisted = False
    try:
        from database import job_set_awaiting_hitl
        gate_persisted = job_set_awaiting_hitl(job_id, gate_payload)
        if gate_persisted:
            logger.info("HITL gate activée pour job %s", job_id)
        else:
            logger.warning("HITL gate : job %s introuvable ou non en statut 'running'", job_id)
    except Exception:
        logger.exception("HITL gate : erreur DB pour job %s", job_id)

    # Mise à jour du cache in-memory (non bloquant)
    try:
        from state import active_jobs
        if job_id in active_jobs:
            active_jobs[job_id]["status"] = "awaiting_validation"
            active_jobs[job_id]["hitl_gate"] = gate_payload
    except Exception:
        pass

    notification = queue_hitl_validation(gate_payload)

    return {
        "job_id": job_id,
        "status": "awaiting_validation" if gate_persisted else "hitl_gate_skipped",
        "gate_payload": gate_payload,
        "notification": notification,
        "requires_human_validation": True,
    }


def resume_hitl_gate(
    *,
    job_id: str,
    approved: bool,
    comment: str = "",
) -> dict[str, Any]:
    """
    Reprend ou annule un job suspendu en attente de validation HITL.

    Args:
        job_id: identifiant du job
        approved: True = reprendre, False = annuler
        comment: commentaire optionnel du validateur humain

    Returns:
        Résultat de la reprise avec nouveau statut.
    """
    try:
        from database import job_resume_after_hitl, get_job
        resumed = job_resume_after_hitl(job_id, approved=approved, comment=comment)
        if not resumed:
            return {
                "job_id": job_id,
                "success": False,
                "error": "Job introuvable ou n'était pas en attente de validation.",
                "new_status": None,
            }
        # Mise à jour du cache in-memory
        try:
            from state import active_jobs, KorymbJobCancelled
            if job_id in active_jobs:
                new_status = "running" if approved else "cancelled"
                active_jobs[job_id]["status"] = new_status
        except Exception:
            pass

        new_status = "running" if approved else "cancelled"
        logger.info(
            "HITL gate résolue pour job %s : %s — '%s'",
            job_id,
            "approuvé" if approved else "rejeté",
            comment[:80] if comment else "",
        )
        return {
            "job_id": job_id,
            "success": True,
            "approved": approved,
            "new_status": new_status,
            "comment": comment[:1000] if comment else "",
        }
    except Exception as exc:
        logger.exception("resume_hitl_gate job %s", job_id)
        return {
            "job_id": job_id,
            "success": False,
            "error": str(exc)[:400],
            "new_status": None,
        }
