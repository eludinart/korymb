"""Guide persistant pour enrichir le contexte de l'espace."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import resolve_tenant

router = APIRouter(tags=["context-guide"])


class AnswerBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    answer: str = Field(min_length=1, max_length=4000)


class OfferBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=64)


def _run(fn):
    try:
        return fn()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/context-guide", dependencies=[Depends(resolve_tenant)])
def context_guide_state():
    from services.context_guide import get_state

    return get_state()


@router.post("/context-guide/answer", dependencies=[Depends(resolve_tenant)])
def context_guide_answer(body: AnswerBody):
    from services.context_guide import submit_answer

    return _run(lambda: submit_answer(body.answer))


@router.post("/context-guide/confirm", dependencies=[Depends(resolve_tenant)])
def context_guide_confirm():
    from services.context_guide import confirm_pending

    return _run(confirm_pending)


@router.post("/context-guide/revise", dependencies=[Depends(resolve_tenant)])
def context_guide_revise():
    from services.context_guide import revise_answer

    return _run(revise_answer)


@router.post("/context-guide/refresh", dependencies=[Depends(resolve_tenant)])
def context_guide_refresh():
    from services.context_guide import refresh_question

    return _run(refresh_question)


@router.post("/context-guide/dismiss", dependencies=[Depends(resolve_tenant)])
def context_guide_dismiss(body: OfferBody):
    from services.context_guide import dismiss_offer

    return _run(lambda: dismiss_offer(body.id))


@router.post("/context-guide/focus", dependencies=[Depends(resolve_tenant)])
def context_guide_focus(body: OfferBody):
    from services.context_guide import focus_offer

    return _run(lambda: focus_offer(body.id))


@router.post("/context-guide/form", dependencies=[Depends(resolve_tenant)])
def context_guide_form():
    from services.context_guide import open_form

    return _run(open_form)


@router.post("/context-guide/list", dependencies=[Depends(resolve_tenant)])
def context_guide_list():
    from services.context_guide import show_list

    return _run(show_list)
