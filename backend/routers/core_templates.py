"""
routers/core_templates.py — Bibliothèque de templates de missions.
CRUD + lancement avec substitution de variables {{placeholder}}.
"""
from __future__ import annotations

import re
import uuid
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from database import (
    list_mission_templates,
    get_mission_template,
    upsert_mission_template,
    delete_mission_template,
)
from services.agents import agents_def
from services.mission import (
    MissionRunConfig,
    _schedule_mission_execution,
    _mission_config_from_payload,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["templates"])

_VAR_RE = re.compile(r"\{\{(\w+)\}\}")


def _extract_variables(mission_text: str) -> list[str]:
    """Détecte les placeholders {{var}} dans le texte et retourne une liste dédupliquée."""
    return list(dict.fromkeys(_VAR_RE.findall(mission_text or "")))


def _substitute_variables(mission_text: str, variables: dict[str, str]) -> str:
    """Remplace chaque {{key}} par sa valeur dans variables."""
    def replacer(m: re.Match) -> str:
        return str(variables.get(m.group(1), m.group(0)))
    return _VAR_RE.sub(replacer, mission_text)


# ── Pydantic models ───────────────────────────────────────────────────────────

class TemplateCreateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field("", max_length=1000)
    agent: str = Field("coordinateur", max_length=100)
    mission_text: str = Field(..., min_length=1, max_length=20000)
    variables: list[str] = Field(default_factory=list)
    config: dict = Field(default_factory=dict)


class TemplateUpdateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=1000)
    agent: str | None = Field(None, max_length=100)
    mission_text: str | None = Field(None, max_length=20000)
    variables: list[str] | None = None
    config: dict | None = None


class TemplateLaunchBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    variables: dict[str, str] = Field(default_factory=dict)
    mission_config: MissionRunConfig | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/templates", dependencies=[Depends(verify_secret)])
def templates_list():
    return {"templates": list_mission_templates()}


@router.post("/templates", dependencies=[Depends(verify_secret)])
def templates_create(body: TemplateCreateBody):
    ad = agents_def()
    agent_key = body.agent if body.agent in ad else "coordinateur"
    # Auto-detect variables from mission_text if not provided
    variables = body.variables or _extract_variables(body.mission_text)
    template_id = str(uuid.uuid4()).replace("-", "")[:12]
    tmpl = upsert_mission_template(
        template_id,
        name=body.name,
        description=body.description,
        agent=agent_key,
        mission_text=body.mission_text,
        variables=variables,
        config=body.config,
    )
    return {"template": tmpl}


@router.get("/templates/{template_id}", dependencies=[Depends(verify_secret)])
def templates_get(template_id: str):
    tmpl = get_mission_template(template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template introuvable.")
    return {"template": tmpl}


@router.put("/templates/{template_id}", dependencies=[Depends(verify_secret)])
def templates_update(template_id: str, body: TemplateUpdateBody):
    existing = get_mission_template(template_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Template introuvable.")
    ad = agents_def()
    new_agent = body.agent if (body.agent and body.agent in ad) else existing["agent"]
    new_mission_text = body.mission_text if body.mission_text is not None else existing["mission_text"]
    # Re-detect variables when mission_text changes and variables not explicitly provided
    if body.variables is not None:
        new_variables = body.variables
    elif body.mission_text is not None:
        new_variables = _extract_variables(new_mission_text)
    else:
        new_variables = existing["variables"]
    tmpl = upsert_mission_template(
        template_id,
        name=body.name if body.name is not None else existing["name"],
        description=body.description if body.description is not None else existing["description"],
        agent=new_agent,
        mission_text=new_mission_text,
        variables=new_variables,
        config=body.config if body.config is not None else existing["config"],
        created_at=existing["created_at"],
    )
    return {"template": tmpl}


@router.delete("/templates/{template_id}", dependencies=[Depends(verify_secret)])
def templates_delete(template_id: str):
    deleted = delete_mission_template(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Template introuvable.")
    return {"deleted": True, "id": template_id}


@router.post("/templates/{template_id}/launch", dependencies=[Depends(verify_secret)])
async def templates_launch(template_id: str, body: TemplateLaunchBody, background_tasks: BackgroundTasks):
    tmpl = get_mission_template(template_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template introuvable.")

    mission_text = _substitute_variables(tmpl["mission_text"], body.variables)
    if not mission_text.strip():
        raise HTTPException(status_code=400, detail="Mission vide après substitution des variables.")

    ad = agents_def()
    agent_key = tmpl["agent"] if tmpl["agent"] in ad else "coordinateur"

    # Merge template config with launch-time override
    base_config = dict(tmpl.get("config") or {})
    if body.mission_config:
        base_config.update(body.mission_config.model_dump(exclude_unset=True))
    mcfg = _mission_config_from_payload(base_config) if base_config else _mission_config_from_payload(None)

    job_id = str(uuid.uuid4())[:8]
    _schedule_mission_execution(
        background_tasks,
        job_id,
        agent_key,
        mission_text,
        None,
        "template",
        mission_config=mcfg,
    )
    logger.info("Template %s lancé → job %s (agent=%s)", template_id, job_id, agent_key)
    return {"status": "accepted", "job_id": job_id, "agent": agent_key, "template_id": template_id}
