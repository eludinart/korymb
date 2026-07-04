from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from auth import resolve_tenant, require_admin
from database import (
    _memory_user_deletable_keys,
    delete_enterprise_context_keys,
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
    delete_keys: list[str] | None = Field(
        default=None,
        description="Volets à retirer du JSON persisté (distinct d'une chaîne vide qui efface le texte).",
    )


class MemorySnapshotBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    comment: str = Field("", max_length=500)


@router.get("/memory", dependencies=[Depends(resolve_tenant)])
def enterprise_memory_get():
    """Contexte entreprise + fil des missions récentes (SQLite)."""
    return get_enterprise_memory()


@router.put("/memory", dependencies=[Depends(resolve_tenant)])
def enterprise_memory_put(body: EnterpriseMemoryPut):
    """Fusionne les champs texte fournis ; crée un snapshot automatique avant écrasement."""
    if not body.contexts and not body.delete_keys:
        return get_enterprise_memory()
    snapshot_warning: str | None = None
    try:
        snapshot_memory_history(comment="auto — avant PUT /memory")
    except Exception as exc:
        snapshot_warning = f"snapshot_auto_failed: {exc}"
    mem = get_enterprise_memory()
    if body.contexts:
        mem = merge_enterprise_contexts(dict(body.contexts))
    if body.delete_keys:
        mem = delete_enterprise_context_keys(list(body.delete_keys))
    if snapshot_warning:
        out = dict(mem)
        out["warning"] = snapshot_warning
        return out
    return mem


@router.delete("/memory/contexts/{context_key}", dependencies=[Depends(resolve_tenant)])
def enterprise_memory_delete_context(context_key: str):
    """Supprime un volet mémoire éditable du stockage (le GET le réexpose vide si autorisé)."""
    key = (context_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Clé manquante.")
    if key not in _memory_user_deletable_keys():
        raise HTTPException(
            status_code=400,
            detail="Cette clé est réservée au système ou non supprimable.",
        )
    try:
        snapshot_memory_history(comment=f"auto — avant DELETE /memory/contexts/{key}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"snapshot_failed: {exc}") from exc
    return delete_enterprise_context_keys([key])


# ── Memory history ────────────────────────────────────────────────────────────

@router.get("/memory/history", dependencies=[Depends(resolve_tenant)])
def memory_history_list(limit: int = Query(default=20, ge=1, le=100)):
    return {"history": list_memory_history(limit)}


@router.get("/memory/history/{snapshot_id}", dependencies=[Depends(resolve_tenant)])
def memory_history_get(snapshot_id: int):
    snap = get_memory_history_snapshot(snapshot_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot introuvable.")
    return {"snapshot": snap}


@router.post("/memory/snapshot", dependencies=[Depends(resolve_tenant)])
def memory_snapshot_manual(body: MemorySnapshotBody):
    try:
        sid = snapshot_memory_history(comment=body.comment or "snapshot manuel")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"snapshot_failed: {exc}")
    snap = get_memory_history_snapshot(sid)
    return {"snapshot": snap}


@router.post("/memory/restore/{snapshot_id}", dependencies=[Depends(resolve_tenant)])
def memory_restore(snapshot_id: int):
    try:
        mem = restore_memory_history_snapshot(snapshot_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"restore_failed: {exc}")
    return {"restored": True, "memory": mem}


@router.get("/memory/preview", dependencies=[Depends(resolve_tenant)])
def memory_preview(
    agent_key: str = Query(default="coordinateur"),
    agents: str | None = Query(default=None, description="Liste CSV d'agents (ex. coordinateur,commercial)"),
):
    """Preview mémoire injectée — un agent ou plusieurs (tiers sémantique + épisodique)."""
    from services.agents import FLEUR_CONTEXT, agents_def
    from services.memory import active_memory_prompt

    keys = []
    if agents and str(agents).strip():
        keys = [k.strip() for k in str(agents).split(",") if k.strip()]
    elif agent_key:
        keys = [agent_key.strip()]

    previews: dict[str, str] = {}
    for k in keys:
        if k not in agents_def():
            continue
        try:
            mem = active_memory_prompt(agent_key=k)
            base = agents_def()[k].get("system") or ""
            previews[k] = base + FLEUR_CONTEXT + mem
        except Exception as exc:
            previews[k] = f"(erreur preview: {exc})"
    return {"agents": previews, "tiers": {"semantic": True, "episodic": True, "session": False}}
