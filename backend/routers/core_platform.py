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


class PortfolioCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    starter_pack_id: str = Field(default="blank", max_length=64)


class PortfolioPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=200)
    paused: bool | None = None


class PortfolioDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm_name: str = Field(min_length=1, max_length=200)


def _portfolio_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        message = str(exc)
        status = 404 if message == "Espace introuvable." else 400
        raise HTTPException(status_code=status, detail=message) from exc


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


@router.get("/platform/portfolio", dependencies=[Depends(require_platform_owner)])
def platform_portfolio():
    from services.platform_portfolio import list_portfolio

    return list_portfolio()


@router.get("/platform/attention", dependencies=[Depends(require_platform_owner)])
def platform_attention(limit: int = 80):
    from services.platform_portfolio import attention_queue

    return attention_queue(limit=limit)


@router.post("/platform/workspaces", dependencies=[Depends(require_platform_owner)])
def platform_create_workspace(body: PortfolioCreate, auth: dict = Depends(require_platform_owner)):
    from services.platform_portfolio import create_client_space

    return _portfolio_call(
        create_client_space,
        name=body.name,
        owner_user_id=str(auth.get("user_id") or ""),
        starter_pack_id=body.starter_pack_id,
    )


@router.patch("/platform/workspaces/{workspace_id}", dependencies=[Depends(require_platform_owner)])
def platform_patch_workspace(workspace_id: str, body: PortfolioPatch):
    from services.platform_portfolio import update_client_space

    if body.name is None and body.paused is None:
        raise HTTPException(status_code=400, detail="Indiquez un nom ou une pause.")
    return _portfolio_call(update_client_space, workspace_id, name=body.name, paused=body.paused)


@router.post("/platform/workspaces/{workspace_id}/archive", dependencies=[Depends(require_platform_owner)])
def platform_archive_workspace(workspace_id: str):
    from services.platform_portfolio import archive_client_space

    return _portfolio_call(archive_client_space, workspace_id)


@router.post("/platform/workspaces/{workspace_id}/restore", dependencies=[Depends(require_platform_owner)])
def platform_restore_workspace(workspace_id: str):
    from services.platform_portfolio import restore_client_space

    return _portfolio_call(restore_client_space, workspace_id)


@router.post("/platform/workspaces/{workspace_id}/delete", dependencies=[Depends(require_platform_owner)])
def platform_delete_workspace(workspace_id: str, body: PortfolioDelete):
    from services.platform_portfolio import delete_client_space

    return _portfolio_call(delete_client_space, workspace_id, confirm_name=body.confirm_name)


@router.post("/platform/workspaces/{workspace_id}/open", dependencies=[Depends(require_platform_owner)])
def platform_open_workspace(workspace_id: str):
    from services.platform_portfolio import open_client_space

    return _portfolio_call(open_client_space, workspace_id)
