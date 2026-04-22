from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth import verify_secret
from database import (
    get_enterprise_memory,
    merge_enterprise_contexts,
    snapshot_memory_history,
    list_memory_history,
    get_memory_history_snapshot,
    restore_memory_history_snapshot,
)

router = APIRouter(tags=["memory"])


class EnterpriseMemoryPut(BaseModel):
    """Mise à jour partielle des contextes persistés (clés : global, commercial, …)."""

    model_config = ConfigDict(extra="ignore")
    contexts: dict[str, str] | None = None


class MemorySnapshotBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    comment: str = Field("", max_length=500)


@router.get("/memory", dependencies=[Depends(verify_secret)])
def enterprise_memory_get():
    """Contexte entreprise + fil des missions récentes (SQLite)."""
    return get_enterprise_memory()


@router.put("/memory", dependencies=[Depends(verify_secret)])
def enterprise_memory_put(body: EnterpriseMemoryPut):
    """Fusionne les champs texte fournis ; crée un snapshot automatique avant écrasement."""
    if body.contexts:
        snapshot_warning: str | None = None
        try:
            snapshot_memory_history(comment="auto — avant PUT /memory")
        except Exception as exc:
            # Le snapshot est un garde-fou, mais ne doit pas bloquer la sauvegarde principale.
            snapshot_warning = f"snapshot_auto_failed: {exc}"
        mem = merge_enterprise_contexts(dict(body.contexts))
        if snapshot_warning:
            out = dict(mem)
            out["warning"] = snapshot_warning
            return out
        return mem
    return get_enterprise_memory()


# ── Memory history ────────────────────────────────────────────────────────────

@router.get("/memory/history", dependencies=[Depends(verify_secret)])
def memory_history_list(limit: int = Query(default=20, ge=1, le=100)):
    return {"history": list_memory_history(limit)}


@router.get("/memory/history/{snapshot_id}", dependencies=[Depends(verify_secret)])
def memory_history_get(snapshot_id: int):
    snap = get_memory_history_snapshot(snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot introuvable.")
    return {"snapshot": snap}


@router.post("/memory/snapshot", dependencies=[Depends(verify_secret)])
def memory_snapshot_manual(body: MemorySnapshotBody):
    try:
        sid = snapshot_memory_history(comment=body.comment or "snapshot manuel")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"snapshot_failed: {exc}")
    snap = get_memory_history_snapshot(sid)
    return {"snapshot": snap}


@router.post("/memory/restore/{snapshot_id}", dependencies=[Depends(verify_secret)])
def memory_restore(snapshot_id: int):
    try:
        mem = restore_memory_history_snapshot(snapshot_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"restore_failed: {exc}")
    return {"restored": True, "memory": mem}


@router.get("/memory/preview", dependencies=[Depends(verify_secret)])
def memory_preview(agent_key: str = Query(default="coordinateur")):
    """Retourne le prompt système complet tel que les agents le voient avant une mission."""
    try:
        from services.memory import active_memory_prompt
        prompt_text = active_memory_prompt(agent_key=agent_key)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erreur assemblage prompt : {exc}")
    return {"agent_key": agent_key, "prompt": prompt_text}
