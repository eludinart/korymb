from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from database import get_orchestration_prompt, list_orchestration_prompts, upsert_orchestration_prompt, seed_orchestration_prompt_defaults
from services.orchestration_prompt_defaults import DEFAULT_ORCHESTRATION_PROMPTS, ORCHESTRATION_PROMPT_KEYS

router = APIRouter(tags=["orchestration-prompts"])


class OrchestrationPromptPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    body: str = Field(..., min_length=1, max_length=500_000)


@router.get("/admin/orchestration-prompts", dependencies=[Depends(verify_secret)])
def orchestration_prompts_list():
    seed_orchestration_prompt_defaults()
    rows = list_orchestration_prompts()
    # Toujours exposer les clés attendues (même si la DB est vide pour une raison X)
    known = {r["prompt_key"]: r for r in rows}
    out = []
    for k in ORCHESTRATION_PROMPT_KEYS:
        if k in known:
            out.append(known[k])
        else:
            out.append({"prompt_key": k, "body_chars": 0, "updated_at": None})
    return {"prompts": out}


@router.get("/admin/orchestration-prompts/{prompt_key}", dependencies=[Depends(verify_secret)])
def orchestration_prompts_get(prompt_key: str):
    seed_orchestration_prompt_defaults()
    k = (prompt_key or "").strip()
    if k not in ORCHESTRATION_PROMPT_KEYS:
        raise HTTPException(status_code=400, detail="prompt_key inconnu.")
    body = get_orchestration_prompt(k) or DEFAULT_ORCHESTRATION_PROMPTS.get(k, "")
    return {"prompt_key": k, "body": body}


@router.put("/admin/orchestration-prompts/{prompt_key}", dependencies=[Depends(verify_secret)])
def orchestration_prompts_put(prompt_key: str, body: OrchestrationPromptPut):
    k = (prompt_key or "").strip()
    if k not in ORCHESTRATION_PROMPT_KEYS:
        raise HTTPException(status_code=400, detail="prompt_key inconnu.")
    try:
        row = upsert_orchestration_prompt(k, body.body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return row


@router.post("/admin/orchestration-prompts/{prompt_key}/reset", dependencies=[Depends(verify_secret)])
def orchestration_prompts_reset(prompt_key: str):
    k = (prompt_key or "").strip()
    if k not in ORCHESTRATION_PROMPT_KEYS:
        raise HTTPException(status_code=400, detail="prompt_key inconnu.")
    default = DEFAULT_ORCHESTRATION_PROMPTS.get(k, "")
    if not default:
        raise HTTPException(status_code=500, detail="Default introuvable.")
    return upsert_orchestration_prompt(k, default)
