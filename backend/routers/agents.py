from __future__ import annotations

from fastapi import APIRouter

from services.agents_config import load_agent_petals

router = APIRouter(prefix="/agents", tags=["agents-phase1"])


@router.get("/petals")
def list_agent_petals():
    return {"agents": load_agent_petals()}

