"""Portefeuille d'instance — lecture des espaces, file à traiter, cycle de vie."""
from __future__ import annotations

import logging
import re
import shutil
from typing import Any

from services.llm_envelope import is_internal_workspace, list_instance_envelopes, update_envelope_policy
from services.workspace_brand import LEGACY_ELUDE_WORKSPACE_ID

logger = logging.getLogger(__name__)

_STATE_RANK = {"bloque": 0, "a_traiter": 1, "calme": 2, "archive": 3}


def _latest(*values: Any) -> str:
    best = ""
    for raw in values:
        value = str(raw or "").strip()
        if value > best:
            best = value
    return best


def _protected(workspace_id: str) -> bool:
    return is_internal_workspace(workspace_id) or (workspace_id or "").strip() == LEGACY_ELUDE_WORKSPACE_ID


def _job_stats() -> dict[str, dict[str, Any]]:
    from database import get_conn

    sql = """
        SELECT workspace_id,
          SUM(CASE WHEN status = 'awaiting_validation' THEN 1 ELSE 0 END) AS hitl,
          SUM(CASE WHEN status = 'quality_blocked' THEN 1 ELSE 0 END) AS quality,
          SUM(CASE WHEN status = 'completed'
                    AND (user_validated_at IS NULL OR TRIM(COALESCE(user_validated_at, '')) = '')
                    AND NOT (
                      LOWER(COALESCE(source, '')) = 'chat'
                      AND parent_job_id IS NOT NULL
                      AND TRIM(COALESCE(parent_job_id, '')) <> ''
                    )
               THEN 1 ELSE 0 END) AS closures,
          SUM(CASE WHEN LOWER(status) LIKE 'error%'
                    AND (user_validated_at IS NULL OR TRIM(COALESCE(user_validated_at, '')) = '')
                    AND NOT (
                      LOWER(COALESCE(source, '')) = 'chat'
                      AND parent_job_id IS NOT NULL
                      AND TRIM(COALESCE(parent_job_id, '')) <> ''
                    )
               THEN 1 ELSE 0 END) AS failures,
          SUM(CASE WHEN status IN ('running', 'pending', 'paused') THEN 1 ELSE 0 END) AS in_progress,
          MAX(updated_at) AS last_job_at
        FROM jobs
        GROUP BY workspace_id
    """
    from workspace_db import _ensure_workspace_public_columns

    try:
        with get_conn() as conn:
            _ensure_workspace_public_columns(conn)
            rows = conn.execute(sql).fetchall()
    except Exception:
        logger.warning("portfolio job stats unavailable", exc_info=True)
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in rows or []:
        item = dict(row)
        wid = str(item.get("workspace_id") or "")
        if wid:
            out[wid] = item
    return out


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _state(*, archived: bool, paused: bool, blocked: bool, failures: int, needs_you: int, warn: bool) -> str:
    if archived:
        return "archive"
    if paused or blocked or failures > 0:
        return "bloque"
    if needs_you > 0 or warn:
        return "a_traiter"
    return "calme"


def _card(env: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    hitl = _int(stats.get("hitl"))
    quality = _int(stats.get("quality"))
    closures = _int(stats.get("closures"))
    failures = _int(stats.get("failures"))
    needs_you = hitl + quality + closures + failures
    archived = bool(str(env.get("archived_at") or "").strip())
    paused = bool(env.get("paused"))
    blocked = bool(env.get("blocked"))
    warn = bool(env.get("warn"))
    wid = str(env.get("workspace_id") or "")
    return {
        "workspace_id": wid,
        "name": env.get("name") or "",
        "slug": env.get("slug") or "",
        "owner_email": env.get("owner_email") or "",
        "owner_name": env.get("owner_name") or "",
        "starter_pack_id": env.get("starter_pack_id") or "",
        "archived_at": str(env.get("archived_at") or ""),
        "protected": _protected(wid),
        "paused": paused,
        "billing": env.get("billing") or "",
        "exempt": bool(env.get("exempt")),
        "own_key": bool(env.get("own_key")),
        "tokens_used_month": _int(env.get("tokens_used_month")),
        "monthly_token_cap": _int(env.get("monthly_token_cap")),
        "percent": _int(env.get("percent")),
        "blocked": blocked,
        "warn": warn,
        "needs_you": needs_you,
        "in_progress": _int(stats.get("in_progress")),
        "failures": failures,
        "last_activity_at": _latest(stats.get("last_job_at"), env.get("last_call_at")),
        "state": _state(
            archived=archived,
            paused=paused,
            blocked=blocked,
            failures=failures,
            needs_you=needs_you,
            warn=warn,
        ),
    }


def list_portfolio() -> dict[str, Any]:
    stats = _job_stats()
    spaces = [_card(env, stats.get(str(env.get("workspace_id") or ""), {})) for env in list_instance_envelopes()]
    spaces.sort(key=lambda item: (_STATE_RANK.get(str(item["state"]), 9), str(item["name"]).lower()))
    active = [item for item in spaces if item["state"] != "archive"]
    archived = [item for item in spaces if item["state"] == "archive"]
    return {
        "spaces": active + archived,
        "active_count": len(active),
        "archived_count": len(archived),
    }


def _require_space(workspace_id: str) -> dict[str, Any]:
    from workspace_db import get_workspace_by_id

    row = get_workspace_by_id((workspace_id or "").strip())
    if not row:
        raise ValueError("Espace introuvable.")
    return row


def _card_for(workspace_id: str) -> dict[str, Any]:
    wid = (workspace_id or "").strip()
    for space in list_portfolio()["spaces"]:
        if space["workspace_id"] == wid:
            return space
    raise ValueError("Espace introuvable.")


def create_client_space(*, name: str, owner_user_id: str, starter_pack_id: str = "blank") -> dict[str, Any]:
    from services.starter_packs import normalize_pack_id
    from workspace_db import create_workspace

    label = (name or "").strip()
    owner = (owner_user_id or "").strip()
    if not label:
        raise ValueError("Indiquez le nom du client.")
    if not owner:
        raise ValueError("Session invalide.")
    pack = normalize_pack_id(starter_pack_id)
    workspace = create_workspace(label, owner, starter_pack_id=pack)
    return _card_for(str(workspace.get("id") or ""))


def update_client_space(workspace_id: str, *, name: str | None = None, paused: bool | None = None) -> dict[str, Any]:
    from workspace_db import update_workspace_name

    row = _require_space(workspace_id)
    wid = str(row.get("id") or "")
    if name is not None:
        label = name.strip()
        if not label:
            raise ValueError("Indiquez un nom.")
        if _protected(wid):
            raise ValueError("L'espace interne ne se renomme pas depuis le portefeuille.")
        update_workspace_name(wid, label)
    if paused is not None:
        if _protected(wid):
            raise ValueError("L'espace interne ne se met pas en pause.")
        update_envelope_policy(wid, paused=bool(paused))
    return _card_for(wid)


def archive_client_space(workspace_id: str) -> dict[str, Any]:
    from workspace_db import set_workspace_archived

    row = _require_space(workspace_id)
    wid = str(row.get("id") or "")
    if _protected(wid):
        raise ValueError("L'espace interne ne s'archive pas.")
    set_workspace_archived(wid, archived=True)
    return _card_for(wid)


def restore_client_space(workspace_id: str) -> dict[str, Any]:
    from workspace_db import set_workspace_archived

    row = _require_space(workspace_id)
    wid = str(row.get("id") or "")
    set_workspace_archived(wid, archived=False)
    return _card_for(wid)


def _purge_files(workspace_id: str) -> None:
    wid = (workspace_id or "").strip()
    if not re.fullmatch(r"ws-[A-Za-z0-9_-]{1,80}", wid):
        return
    from services.email_files import files_root as mail_root
    from services.resource_files import files_root as resource_root

    for root_fn in (resource_root, mail_root):
        try:
            root = root_fn().resolve()
            target = (root / wid).resolve()
            target.relative_to(root)
            if target == root or not target.is_dir():
                continue
            shutil.rmtree(target)
        except Exception:
            logger.warning("purge fichiers espace %s ignorée", wid, exc_info=True)


def delete_client_space(workspace_id: str, *, confirm_name: str) -> dict[str, Any]:
    from workspace_db import delete_workspace_records, workspace_archived

    row = _require_space(workspace_id)
    wid = str(row.get("id") or "")
    if _protected(wid):
        raise ValueError("L'espace interne ne se supprime pas.")
    if not workspace_archived(row):
        raise ValueError("Archivez l'espace avant de le supprimer.")
    expected = str(row.get("name") or "").strip()
    if (confirm_name or "").strip() != expected:
        raise ValueError("Le nom saisi ne correspond pas à l'espace.")
    delete_workspace_records(wid)
    _purge_files(wid)
    return {"ok": True, "workspace_id": wid}


def open_client_space(workspace_id: str) -> dict[str, Any]:
    row = _require_space(workspace_id)
    return {
        "workspace_id": str(row.get("id") or ""),
        "name": row.get("name") or "",
        "slug": row.get("slug") or "",
    }


def _kind_for_job(status: str) -> tuple[str, str] | None:
    raw = str(status or "").strip()
    lowered = raw.lower()
    if raw == "awaiting_validation":
        return "hitl", "Décision en attente"
    if raw == "quality_blocked":
        return "quality", "Qualité bloquée"
    if raw == "completed":
        return "closure", "Mission à clôturer"
    if lowered.startswith("error"):
        return "mission_error", "Mission en échec"
    return None


def attention_queue(*, limit: int = 80) -> dict[str, Any]:
    from database import get_conn

    lim = max(1, min(int(limit), 120))
    sql = """
        SELECT j.id, j.workspace_id, j.mission, j.status, j.updated_at, w.name AS workspace_name
        FROM jobs j
        JOIN korymb_workspaces w ON w.id = j.workspace_id
        WHERE TRIM(COALESCE(w.archived_at, '')) = ''
          AND (
            j.status IN ('awaiting_validation', 'quality_blocked')
            OR (
              j.status = 'completed'
              AND (j.user_validated_at IS NULL OR TRIM(COALESCE(j.user_validated_at, '')) = '')
              AND NOT (
                LOWER(COALESCE(j.source, '')) = 'chat'
                AND j.parent_job_id IS NOT NULL
                AND TRIM(COALESCE(j.parent_job_id, '')) <> ''
              )
            )
            OR (
              LOWER(j.status) LIKE 'error%'
              AND (j.user_validated_at IS NULL OR TRIM(COALESCE(j.user_validated_at, '')) = '')
              AND NOT (
                LOWER(COALESCE(j.source, '')) = 'chat'
                AND j.parent_job_id IS NOT NULL
                AND TRIM(COALESCE(j.parent_job_id, '')) <> ''
              )
            )
          )
        ORDER BY j.updated_at DESC
        LIMIT ?
    """
    items: list[dict[str, Any]] = []
    from workspace_db import _ensure_workspace_public_columns

    try:
        with get_conn() as conn:
            _ensure_workspace_public_columns(conn)
            rows = conn.execute(sql, (lim,)).fetchall()
    except Exception:
        logger.warning("portfolio attention unavailable", exc_info=True)
        rows = []
    for row in rows or []:
        item = dict(row)
        kind = _kind_for_job(str(item.get("status") or ""))
        if not kind:
            continue
        title = str(item.get("mission") or "").strip() or kind[1]
        items.append(
            {
                "workspace_id": str(item.get("workspace_id") or ""),
                "workspace_name": str(item.get("workspace_name") or ""),
                "kind": kind[0],
                "kind_label": kind[1],
                "title": title[:180],
                "at": str(item.get("updated_at") or ""),
                "open_path": "/inbox",
            }
        )
    for env in list_instance_envelopes():
        if str(env.get("archived_at") or "").strip():
            continue
        if env.get("exempt") or env.get("billing") != "platform":
            continue
        if env.get("paused"):
            continue
        if not (env.get("warn") or env.get("blocked")):
            continue
        reached = bool(env.get("blocked"))
        items.append(
            {
                "workspace_id": str(env.get("workspace_id") or ""),
                "workspace_name": str(env.get("name") or ""),
                "kind": "envelope",
                "kind_label": "Enveloppe IA",
                "title": "Plafond atteint" if reached else "Plafond presque atteint",
                "at": str(env.get("last_call_at") or ""),
                "open_path": "",
            }
        )
    items.sort(key=lambda item: str(item.get("at") or ""), reverse=True)
    trimmed = items[:lim]
    return {"items": trimmed, "count": len(trimmed)}
