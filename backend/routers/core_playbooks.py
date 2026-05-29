"""API playbooks métier Fleur / Sivana."""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from database import get_playbook, list_playbooks, upsert_playbook
from services.agents import agents_def
from services.mission import _mission_config_from_payload, _schedule_mission_execution

logger = logging.getLogger(__name__)
router = APIRouter(tags=["playbooks"])


class PlaybookBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    category: str = Field(default="generic", pattern="^(fleur|sivana|generic)$")
    steps: dict = Field(default_factory=dict)
    template_id: str | None = None


class PlaybookLaunchBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mission_override: str = ""
    require_user_validation: bool | None = None


@router.get("/playbooks", dependencies=[Depends(verify_secret)])
def playbooks_list(category: str | None = None):
    return {"playbooks": list_playbooks(category=category)}


@router.post("/playbooks", dependencies=[Depends(verify_secret)])
def playbooks_upsert(body: PlaybookBody, playbook_id: str | None = None):
    pid = (playbook_id or uuid.uuid4().hex[:12]).strip()[:32]
    row = upsert_playbook(
        pid,
        name=body.name,
        description=body.description,
        category=body.category,
        steps=body.steps,
        template_id=body.template_id,
    )
    return row


@router.get("/playbooks/{playbook_id}", dependencies=[Depends(verify_secret)])
def playbooks_get(playbook_id: str):
    row = get_playbook(playbook_id)
    if not row:
        raise HTTPException(status_code=404, detail="Playbook introuvable.")
    return row


@router.post("/playbooks/{playbook_id}/launch", dependencies=[Depends(verify_secret)])
def playbooks_launch(playbook_id: str, body: PlaybookLaunchBody, background_tasks: BackgroundTasks):
    pb = get_playbook(playbook_id)
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook introuvable.")
    steps = pb.get("steps") if isinstance(pb.get("steps"), dict) else {}
    mission_text = (body.mission_override or steps.get("mission") or pb.get("description") or pb.get("name") or "").strip()
    if not mission_text:
        raise HTTPException(status_code=400, detail="Mission vide pour ce playbook.")
    agents_list = steps.get("agents") if isinstance(steps.get("agents"), list) else []
    agent_key = str(agents_list[0] if agents_list else steps.get("agent") or "coordinateur")
    ad = agents_def()
    if agent_key not in ad:
        agent_key = "coordinateur"
    base_cfg = dict(steps.get("mission_config") or {})
    if body.require_user_validation is not None:
        base_cfg["require_user_validation"] = body.require_user_validation
    if steps.get("budget_cap_usd"):
        base_cfg["budget_cap_usd"] = steps.get("budget_cap_usd")
    if steps.get("cio_plan_hitl_enabled") is not None:
        base_cfg["cio_plan_hitl_enabled"] = steps.get("cio_plan_hitl_enabled")
    mcfg = _mission_config_from_payload(base_cfg or None)
    job_id = uuid.uuid4().hex[:12]
    _schedule_mission_execution(
        background_tasks,
        job_id,
        agent_key,
        mission_text,
        steps.get("context") if isinstance(steps.get("context"), dict) else None,
        f"playbook:{playbook_id}",
        mission_config=mcfg,
    )
    logger.info("Playbook %s lancé → job %s", playbook_id, job_id)
    return {"status": "accepted", "job_id": job_id, "playbook_id": playbook_id, "agent": agent_key}
