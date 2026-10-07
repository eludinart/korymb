"""Console d'instance — enveloppes IA des espaces."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from services.workspace_auth import require_operator, require_platform_owner

router = APIRouter(tags=["platform"])


class EnvelopePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    monthly_token_cap: int | None = Field(default=None, ge=0, le=50_000_000)
    paused: bool | None = None


@router.get("/config/envelope")
def config_envelope(auth: dict = Depends(require_operator)):
    from services.llm_envelope import envelope_status

    return envelope_status(str(auth.get("workspace_id") or ""))


@router.get("/platform/llm-envelopes", dependencies=[Depends(require_platform_owner)])
def platform_list_envelopes():
    from services.llm_envelope import list_instance_envelopes

    rows = list_instance_envelopes()
    return {"envelopes": rows, "count": len(rows)}


@router.patch("/platform/llm-envelopes/{workspace_id}", dependencies=[Depends(require_platform_owner)])
def platform_patch_envelope(workspace_id: str, body: EnvelopePatch):
    from services.llm_envelope import update_envelope_policy

    if body.monthly_token_cap is None and body.paused is None:
        raise HTTPException(status_code=400, detail="Indiquez un plafond ou une pause.")
    try:
        return update_envelope_policy(
            workspace_id,
            monthly_token_cap=body.monthly_token_cap,
            paused=body.paused,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
