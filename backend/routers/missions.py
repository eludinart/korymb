"""
routers/missions.py — Endpoints mission : peer review, HITL gate, HITL validate.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from services.orchestrator import build_peer_review_plan, prepare_hitl_gate, resume_hitl_gate

router = APIRouter(prefix="/missions", tags=["missions-phase1"])


class PeerReviewPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mission: str = Field(min_length=3, max_length=6000)
    primary_agent: str = Field(default="commercial", min_length=2, max_length=64)
    devil_advocate_agent: str = Field(default="developpeur", min_length=2, max_length=64)


class HitlGateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: str = Field(min_length=4, max_length=16)
    mission: str = Field(min_length=3, max_length=6000)
    result_preview: str = Field(min_length=3, max_length=12000)
    reviewer: str = Field(default="human_operator", min_length=3, max_length=120)


class HitlValidateRequest(BaseModel):
    """Corps de la requête de validation HITL humaine."""
    model_config = ConfigDict(extra="forbid")
    approved: bool | None = None
    comment: str = Field(default="", max_length=8000)
    decision: Literal["approve", "reject", "amend"] | None = None
    amended_plan: dict | None = None
    feedback: str = Field(default="", max_length=4000)


@router.post("/plan-peer-review", dependencies=[Depends(verify_secret)])
def mission_plan_peer_review(body: PeerReviewPlanRequest):
    plan = build_peer_review_plan(
        mission=body.mission,
        primary_agent=body.primary_agent,
        devil_advocate_agent=body.devil_advocate_agent,
    )
    return plan.model_dump()


@router.post("/hitl-gate", dependencies=[Depends(verify_secret)])
def mission_hitl_gate(body: HitlGateRequest):
    """
    Suspend manuellement un job en attente de validation HITL.
    Peut être déclenché par l'UI ou un agent déclencheur d'action critique.
    """
    return prepare_hitl_gate(
        job_id=body.job_id,
        mission=body.mission,
        result_preview=body.result_preview,
        reviewer=body.reviewer,
    )


@router.post("/jobs/{job_id}/hitl-gate", dependencies=[Depends(verify_secret)])
def job_hitl_gate(job_id: str, body: HitlGateRequest):
    """
    Alias REST : suspend le job spécifié dans l'URL path.
    Permet l'invocation directe depuis le détail d'un job.
    """
    if body.job_id and body.job_id != job_id:
        raise HTTPException(status_code=400, detail="job_id du body ne correspond pas à l'URL.")
    return prepare_hitl_gate(
        job_id=job_id,
        mission=body.mission,
        result_preview=body.result_preview,
        reviewer=body.reviewer,
    )


@router.post("/jobs/{job_id}/validate", dependencies=[Depends(verify_secret)])
def job_hitl_validate(job_id: str, body: HitlValidateRequest):
    """
    Valide ou rejette un job en attente de validation HITL.
    - decision=approve (ou approved=true)  : reprend l'exécution
    - decision=reject (ou approved=false) : annule le job
    - decision=amend + amended_plan : reprend avec plan fusionné dirigeant
    """
    result = resume_hitl_gate(
        job_id=job_id,
        approved=body.approved,
        comment=body.comment,
        decision=body.decision,
        amended_plan=body.amended_plan,
        feedback=body.feedback,
    )
    if not result.get("success"):
        err = str(result.get("error") or "").strip()
        code = 400 if "amend" in err.lower() or "requiert" in err.lower() else 404
        raise HTTPException(status_code=code, detail=err or "Job introuvable ou état invalide pour la validation HITL.")
    return result


@router.get("/jobs/{job_id}/hitl-status", dependencies=[Depends(verify_secret)])
def job_hitl_status(job_id: str):
    """Retourne l'état HITL courant d'un job (gate payload, resolved_at, comment)."""
    try:
        from database import get_hitl_gate, get_job
        job = get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job introuvable.")
        gate = get_hitl_gate(job_id)
        return {
            "job_id": job_id,
            "status": job.get("status"),
            "hitl": gate,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
