"""File d'actions HITL — enqueue + validation dirigeant."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import require_admin
from services.action_queue import enqueue_action, get_action, list_actions, resolve_action

router = APIRouter(tags=["actions"])


class ActionCreateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = Field(..., min_length=2, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    summary: str = Field("", max_length=2000)
    payload: dict = Field(default_factory=dict)
    job_id: str | None = Field(None, max_length=64)
    source: str = Field("korymb", max_length=64)
    preview_url: str | None = Field(None, max_length=2000)


class ActionResolveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]
    source: str = Field("inbox", max_length=32)
    comment: str = Field("", max_length=2000)


@router.post("/actions", dependencies=[Depends(require_admin)])
def actions_create(body: ActionCreateBody):
    try:
        ticket = enqueue_action(
            kind=body.kind,
            title=body.title,
            summary=body.summary,
            payload=body.payload,
            job_id=body.job_id,
            source=body.source,
            preview_url=body.preview_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ticket


@router.get("/actions", dependencies=[Depends(require_admin)])
def actions_list(status: str | None = "pending", limit: int = 50):
    return {"actions": list_actions(status=status or None, limit=limit)}


@router.get("/actions/{ticket_id}", dependencies=[Depends(require_admin)])
def actions_get(ticket_id: str):
    ticket = get_action(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket introuvable.")
    return ticket


@router.post("/actions/{ticket_id}/resolve", dependencies=[Depends(require_admin)])
def actions_resolve(ticket_id: str, body: ActionResolveBody):
    result = resolve_action(
        ticket_id,
        decision=body.decision,
        source=body.source,
        comment=body.comment,
    )
    if result.get("status_code"):
        raise HTTPException(status_code=int(result["status_code"]), detail=result.get("error") or "Échec")
    return result
