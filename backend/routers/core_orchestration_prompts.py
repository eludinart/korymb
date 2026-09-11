from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import resolve_tenant, require_admin
from database import get_orchestration_prompt, list_orchestration_prompts, upsert_orchestration_prompt, seed_orchestration_prompt_defaults
from services.orchestration_prompt_defaults import DEFAULT_ORCHESTRATION_PROMPTS, ORCHESTRATION_PROMPT_KEYS

router = APIRouter(tags=["orchestration-prompts"])


class OrchestrationPromptPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    body: str = Field(..., min_length=1, max_length=500_000)


def _safe_seed_orchestration_prompts() -> None:
    try:
        seed_orchestration_prompt_defaults()
    except Exception:
        pass


def _prompt_body_or_default(prompt_key: str) -> str:
    body = ""
    try:
        body = get_orchestration_prompt(prompt_key) or ""
    except Exception:
        body = ""
    if body:
        return body
    return DEFAULT_ORCHESTRATION_PROMPTS.get(prompt_key, "")


@router.get("/admin/orchestration-prompts", dependencies=[Depends(require_admin)])
def orchestration_prompts_list():
    _safe_seed_orchestration_prompts()
    try:
        rows = list_orchestration_prompts()
    except Exception:
        rows = []
    # Toujours exposer les clés attendues (même si la DB est vide pour une raison X)
    known = {r["prompt_key"]: r for r in rows}
    out = []
    for k in ORCHESTRATION_PROMPT_KEYS:
        if k in known:
            row = dict(known[k])
            if not str(row.get("body") or ""):
                row["body"] = DEFAULT_ORCHESTRATION_PROMPTS.get(k, "")
                row["body_chars"] = len(str(row["body"]))
            out.append(row)
        else:
            body = DEFAULT_ORCHESTRATION_PROMPTS.get(k, "")
            out.append({"prompt_key": k, "body": body, "body_chars": len(body), "updated_at": None})
    return {"prompts": out}


@router.get("/admin/orchestration-prompts/{prompt_key}", dependencies=[Depends(require_admin)])
def orchestration_prompts_get(prompt_key: str):
    k = (prompt_key or "").strip()
    if k not in ORCHESTRATION_PROMPT_KEYS:
        raise HTTPException(status_code=400, detail="prompt_key inconnu.")
    _safe_seed_orchestration_prompts()
    return {"prompt_key": k, "body": _prompt_body_or_default(k)}


@router.put("/admin/orchestration-prompts/{prompt_key}", dependencies=[Depends(require_admin)])
def orchestration_prompts_put(prompt_key: str, body: OrchestrationPromptPut):
    k = (prompt_key or "").strip()
    if k not in ORCHESTRATION_PROMPT_KEYS:
        raise HTTPException(status_code=400, detail="prompt_key inconnu.")
    try:
        row = upsert_orchestration_prompt(k, body.body)
        from database import append_orchestration_prompt_history

        append_orchestration_prompt_history(k, body.body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return row


@router.post("/admin/orchestration-prompts/{prompt_key}/reset", dependencies=[Depends(require_admin)])
def orchestration_prompts_reset(prompt_key: str):
    k = (prompt_key or "").strip()
    if k not in ORCHESTRATION_PROMPT_KEYS:
        raise HTTPException(status_code=400, detail="prompt_key inconnu.")
    default = DEFAULT_ORCHESTRATION_PROMPTS.get(k, "")
    if not default:
        raise HTTPException(status_code=500, detail="Default introuvable.")
    return upsert_orchestration_prompt(k, default)
