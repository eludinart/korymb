"""API agent_bus — messages inter-nœuds second cerveau."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth import require_admin
from database import LONG_TEXT_CHARS
from services import agent_bus
from services import agent_bus_bridge

router = APIRouter(prefix="/agent-bus", tags=["agent-bus"])


class MessageCreateBody(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    from_node: str = Field(..., alias="from", min_length=2, max_length=32)
    to_node: str = Field(..., alias="to", min_length=1, max_length=32)
    topic: str = Field(..., min_length=1, max_length=128)
    body: str = Field(..., min_length=1, max_length=LONG_TEXT_CHARS)
    reply_to: str | None = Field(None, max_length=64)


class MessageDoneBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    comment: str = Field("", max_length=LONG_TEXT_CHARS)


class MessageProgressBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str = Field(..., min_length=1, max_length=LONG_TEXT_CHARS)


@router.post("/messages", dependencies=[Depends(require_admin)])
def messages_create(body: MessageCreateBody):
    try:
        msg = agent_bus.create_message(
            from_node=body.from_node,
            to_node=body.to_node,
            topic=body.topic,
            body=body.body,
            reply_to=body.reply_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    task = agent_bus_bridge.sync_task_on_bus_create(msg)
    if task:
        msg = {**msg, "task_id": task.get("id")}
    return msg


@router.get("/messages", dependencies=[Depends(require_admin)])
def messages_list(
    to: str | None = Query(None),
    from_node: str | None = Query(None, alias="from"),
    topic: str | None = Query(None),
    status: str | None = Query("open"),
    limit: int = Query(50, ge=1, le=200),
):
    try:
        return {
            "messages": agent_bus.list_messages(
                to_node=to,
                from_node=from_node,
                topic=topic,
                status=status,
                limit=limit,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/messages/{message_id}/ack", dependencies=[Depends(require_admin)])
def messages_ack(message_id: str):
    try:
        return agent_bus.ack_message(message_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Message introuvable.") from None


@router.post("/messages/{message_id}/progress", dependencies=[Depends(require_admin)])
def messages_progress(message_id: str, body: MessageProgressBody):
    try:
        return agent_bus_bridge.append_progress(message_id, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError:
        raise HTTPException(status_code=404, detail="Message ou tâche liée introuvable.") from None


@router.post("/messages/{message_id}/done", dependencies=[Depends(require_admin)])
def messages_done(message_id: str, body: MessageDoneBody | None = None):
    try:
        msg = agent_bus.done_message(message_id, comment=(body.comment if body else ""))
    except KeyError:
        raise HTTPException(status_code=404, detail="Message introuvable.") from None
    task = agent_bus_bridge.sync_task_on_bus_done(msg)
    if task:
        msg = {**msg, "task_id": task.get("id")}
    return msg
