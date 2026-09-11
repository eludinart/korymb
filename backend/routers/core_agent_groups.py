"""
routers/core_agent_groups.py — Groupes d'agents + blueprints d'équipe.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import require_admin, resolve_tenant
from services.agent_groups import (
    archive_group,
    confirm_blueprint,
    create_blueprint_proposal,
    ensure_enterprise_group,
    get_blueprint,
    get_group,
    get_group_memory,
    list_blueprints,
    list_group_templates,
    list_groups,
    propose_blueprint_from_template,
    reject_blueprint,
    set_group_memory,
    update_group_members,
)

router = APIRouter(tags=["agent-groups"])


class BlueprintProposeBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str = Field(..., min_length=1, max_length=120)
    intent: str = Field("", max_length=4000)
    lead: dict = Field(default_factory=dict)
    members: list[dict] = Field(default_factory=list)
    out_of_scope: list[str] = Field(default_factory=list)
    simulation: str = ""
    risks: list[str] = Field(default_factory=list)
    template_key: str | None = None
    chat_session_id: str | None = None


class BlueprintFromTemplateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    template_key: str = Field(..., min_length=1, max_length=64)
    intent: str = Field("", max_length=4000)


class GroupUpdateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str | None = Field(None, max_length=160)
    description: str | None = Field(None, max_length=2000)
    lead_agent_key: str | None = Field(None, max_length=80)
    member_keys: list[str] | None = None
    status: str | None = Field(None, max_length=32)
    policy: dict | None = None


class GroupMemoryBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    notes: str | None = Field(None, max_length=16000)
    inherit_shared: bool | None = None


@router.get("/agent-groups", dependencies=[Depends(resolve_tenant)])
def api_list_groups(include_archived: bool = False):
    ensure_enterprise_group()
    return {"groups": list_groups(include_archived=include_archived)}


@router.get("/agent-groups/templates", dependencies=[Depends(resolve_tenant)])
def api_list_templates():
    return {"templates": list_group_templates()}


@router.get("/agent-groups/{group_id}", dependencies=[Depends(resolve_tenant)])
def api_get_group(group_id: str):
    g = get_group(group_id)
    if not g:
        raise HTTPException(status_code=404, detail="groupe introuvable")
    return {"group": g}


@router.get("/agent-groups/{group_id}/memory", dependencies=[Depends(resolve_tenant)])
def api_get_group_memory(group_id: str):
    if not get_group(group_id):
        raise HTTPException(status_code=404, detail="groupe introuvable")
    return {"memory": get_group_memory(group_id)}


@router.put("/admin/agent-groups/{group_id}/memory", dependencies=[Depends(require_admin)])
def api_put_group_memory(group_id: str, body: GroupMemoryBody):
    try:
        mem = set_group_memory(
            group_id,
            notes=body.notes,
            inherit_shared=body.inherit_shared,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "memory": mem}


@router.patch("/admin/agent-groups/{group_id}", dependencies=[Depends(require_admin)])
def api_update_group(group_id: str, body: GroupUpdateBody):
    try:
        g = update_group_members(
            group_id,
            label=body.label,
            description=body.description,
            lead_agent_key=body.lead_agent_key,
            member_keys=body.member_keys,
            status=body.status,
            policy=body.policy,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "group": g}


@router.post("/admin/agent-groups/{group_id}/archive", dependencies=[Depends(require_admin)])
def api_archive_group(group_id: str):
    try:
        g = archive_group(group_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "group": g}


@router.get("/team-blueprints", dependencies=[Depends(resolve_tenant)])
def api_list_blueprints(limit: int = 30):
    return {"blueprints": list_blueprints(limit=limit)}


@router.get("/team-blueprints/{blueprint_id}", dependencies=[Depends(resolve_tenant)])
def api_get_blueprint(blueprint_id: str):
    bp = get_blueprint(blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="blueprint introuvable")
    return {"blueprint": bp}


@router.post("/team-blueprints/propose", dependencies=[Depends(require_admin)])
def api_propose_blueprint(body: BlueprintProposeBody):
    try:
        bp = create_blueprint_proposal(
            {
                "label": body.label,
                "intent": body.intent,
                "lead": body.lead,
                "members": body.members,
                "out_of_scope": body.out_of_scope,
                "simulation": body.simulation,
                "risks": body.risks,
                "template_key": body.template_key,
            },
            chat_session_id=body.chat_session_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "blueprint": bp}


@router.post("/team-blueprints/propose-template", dependencies=[Depends(require_admin)])
def api_propose_from_template(body: BlueprintFromTemplateBody):
    try:
        bp = propose_blueprint_from_template(body.template_key, intent=body.intent)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "blueprint": bp}


@router.post("/team-blueprints/{blueprint_id}/confirm", dependencies=[Depends(require_admin)])
def api_confirm_blueprint(blueprint_id: str):
    try:
        result = confirm_blueprint(blueprint_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return result


@router.post("/team-blueprints/{blueprint_id}/reject", dependencies=[Depends(require_admin)])
def api_reject_blueprint(blueprint_id: str):
    try:
        result = reject_blueprint(blueprint_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return result
