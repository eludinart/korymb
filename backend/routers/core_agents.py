"""
routers/core_agents.py — Domaine agents : liste publique, admin CRUD custom agents.
Extrait de main.py — contrats API préservés à l'identique.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from database import (
    ALLOWED_AGENT_TOOL_TAGS,
    delete_custom_agent,
    upsert_custom_agent,
    validate_custom_agent_key,
)
from services.agents import (
    BUILTIN_AGENT_DEFINITIONS,
    agents_def,
    refresh_agents_definitions_cache,
)

router = APIRouter(tags=["agents"])


class AdminAgentUpsertBody(BaseModel):
    """Création ou mise à jour d'un agent métier personnalisé (clé dans l'URL)."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(..., min_length=1, max_length=160)
    role: str = Field("", max_length=400)
    system: str = Field(..., min_length=1, max_length=32000)
    tools: list[str] = Field(default_factory=list)


@router.get("/agents")
def list_agents():
    ad = agents_def()
    return {
        "agents": [
            {
                "key": k,
                "label": v["label"],
                "role": v["role"],
                "tools": v.get("tools", []),
                "is_manager": v.get("is_manager", False),
                "builtin": k in BUILTIN_AGENT_DEFINITIONS,
            }
            for k, v in ad.items()
        ],
        "tool_tags": sorted(ALLOWED_AGENT_TOOL_TAGS),
    }


@router.get("/admin/agents", dependencies=[Depends(verify_secret)])
def admin_agents_definitions():
    """Définitions complètes (y compris prompts) + liste des tags d'outils autorisés."""
    ad = agents_def()
    return {
        "agents": [
            {
                "key": k,
                "label": v["label"],
                "role": v.get("role", ""),
                "system": v.get("system", ""),
                "tools": v.get("tools", []),
                "is_manager": v.get("is_manager", False),
                "builtin": k in BUILTIN_AGENT_DEFINITIONS,
            }
            for k, v in ad.items()
        ],
        "tool_tags": sorted(ALLOWED_AGENT_TOOL_TAGS),
    }


@router.put("/admin/agents/custom/{agent_key}", dependencies=[Depends(verify_secret)])
def admin_upsert_custom_agent(agent_key: str, body: AdminAgentUpsertBody):
    raw = (agent_key or "").strip()
    canon, err = validate_custom_agent_key(raw)
    if err:
        raise HTTPException(status_code=400, detail=err)
    try:
        upsert_custom_agent(
            canon,
            label=body.label,
            role=body.role,
            system_prompt=body.system,
            tools=body.tools,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    refresh_agents_definitions_cache()
    return {"ok": True, "key": canon}


@router.delete("/admin/agents/custom/{agent_key}", dependencies=[Depends(verify_secret)])
def admin_delete_custom_agent(agent_key: str):
    try:
        deleted = delete_custom_agent((agent_key or "").strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    refresh_agents_definitions_cache()
    return {"ok": True, "deleted": bool(deleted)}
