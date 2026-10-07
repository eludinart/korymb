"""Enveloppe IA incluse — plafond mensuel quand l'espace utilise la clé du serveur.

Un espace avec sa propre clé pour le fournisseur actif n'est pas plafonné.
L'espace interne Élude (`ws-default-legacy`) est hors enveloppe.
"""
from __future__ import annotations

import json
import os
from contextvars import ContextVar
from datetime import datetime
from typing import Any

from services.workspace_brand import LEGACY_ELUDE_WORKSPACE_ID

DEFAULT_MONTHLY_TOKEN_CAP = 500_000
WARN_RATIO = 0.8
_MAX_CAP = 50_000_000

EXHAUSTED_MESSAGE = (
    "L'enveloppe IA de cet espace est atteinte pour ce mois. Elle se renouvelle le 1er."
)
PAUSED_MESSAGE = "L'IA de cet espace est en pause."

_PROVIDER_KEY_FIELD = {
    "anthropic": "anthropic_api_key",
    "mistral": "mistral_api_key",
    "openrouter": "openrouter_api_key",
}

_billing_source: ContextVar[str] = ContextVar("llm_billing_source", default="platform")


class LlmEnvelopeError(RuntimeError):
    """Appel refusé : enveloppe atteinte ou IA en pause."""


def current_billing_source() -> str:
    return _billing_source.get()


def is_internal_workspace(workspace_id: str | None) -> bool:
    return (workspace_id or "").strip() == LEGACY_ELUDE_WORKSPACE_ID


def is_platform_owner(user_id: str) -> bool:
    """Propriétaire d'instance : e-mail explicite, ou propriétaire de l'espace Élude."""
    from workspace_db import get_user_by_id, get_workspace_by_id

    user = get_user_by_id(user_id)
    if not user:
        return False
    email = str(user.get("email") or "").strip().lower()
    raw = os.getenv("KORYMB_PLATFORM_OWNER_EMAIL", "").strip()
    if raw and email:
        allowed = {part.strip().lower() for part in raw.split(",") if part.strip()}
        if email in allowed:
            return True
    legacy = get_workspace_by_id(LEGACY_ELUDE_WORKSPACE_ID) or {}
    return bool(legacy.get("owner_user_id")) and str(legacy.get("owner_user_id")) == (user_id or "").strip()


def month_start_utc() -> str:
    now = datetime.utcnow()
    return now.replace(day=1).date().isoformat()


def next_renewal_label() -> str:
    now = datetime.utcnow()
    year = now.year + (1 if now.month == 12 else 0)
    month = 1 if now.month == 12 else now.month + 1
    return f"{year:04d}-{month:02d}-01"


def _persisted_llm_blob(workspace_id: str) -> dict[str, Any]:
    from database import get_conn

    wid = (workspace_id or "").strip()
    if not wid:
        return {}
    keys = (f"{wid}:default", "default")
    with get_conn() as conn:
        row = None
        for key in keys:
            row = conn.execute(
                "SELECT value_json FROM llm_runtime_settings WHERE store_key = ? AND workspace_id = ?",
                (key, wid),
            ).fetchone()
            if row:
                break
    if not row:
        return {}
    raw = dict(row).get("value_json") if not isinstance(row, tuple) else row[0]
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def workspace_has_own_key(workspace_id: str) -> bool:
    """Vrai si la clé du fournisseur effectif est enregistrée sur cet espace (pas seulement dans l'env serveur)."""
    from config import settings
    from llm_providers import normalize_llm_provider

    data = _persisted_llm_blob(workspace_id)
    provider = normalize_llm_provider(str(data.get("llm_provider") or "") or None, {"llm_provider": settings.llm_provider})
    field = _PROVIDER_KEY_FIELD.get(provider)
    if not field:
        return False
    return bool(str(data.get(field) or "").strip())


def resolve_billing_source(workspace_id: str | None = None) -> str:
    from tenant_context import get_workspace_id
    from workspace_db import ws_id

    wid = (workspace_id or get_workspace_id() or ws_id() or "").strip()
    if is_internal_workspace(wid):
        return "exempt"
    if workspace_has_own_key(wid):
        return "own"
    return "platform"


def _policy_row(workspace_id: str) -> dict[str, Any]:
    from workspace_db import get_workspace_by_id

    row = get_workspace_by_id(workspace_id) or {}
    try:
        cap = int(row.get("llm_monthly_token_cap") if row.get("llm_monthly_token_cap") is not None else DEFAULT_MONTHLY_TOKEN_CAP)
    except (TypeError, ValueError):
        cap = DEFAULT_MONTHLY_TOKEN_CAP
    if cap < 0:
        cap = 0
    if cap > _MAX_CAP:
        cap = _MAX_CAP
    paused_raw = row.get("llm_paused")
    if isinstance(paused_raw, bool):
        paused = paused_raw
    else:
        try:
            paused = int(paused_raw or 0) != 0
        except (TypeError, ValueError):
            paused = str(paused_raw or "").strip().lower() in {"1", "true", "yes"}
    return {"monthly_token_cap": cap, "paused": paused}


def sum_platform_tokens_month(workspace_id: str, *, month_start: str | None = None) -> int:
    from database import get_conn, _ensure_llm_usage_table

    start = month_start or month_start_utc()
    wid = (workspace_id or "").strip()
    with get_conn() as conn:
        _ensure_llm_usage_table(conn)
        row = conn.execute(
            "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM llm_usage_events "
            "WHERE workspace_id = ? AND billing_source = 'platform' AND substr(created_at, 1, 10) >= ?",
            (wid, start),
        ).fetchone()
    if not row:
        return 0
    try:
        return int(row[0] or 0)
    except (TypeError, ValueError, KeyError):
        try:
            return int(list(dict(row).values())[0] or 0)
        except Exception:
            return 0


def envelope_status(workspace_id: str | None = None) -> dict[str, Any]:
    from tenant_context import get_workspace_id
    from workspace_db import ws_id

    wid = (workspace_id or get_workspace_id() or ws_id() or "").strip()
    billing = resolve_billing_source(wid)
    policy = _policy_row(wid)
    used = 0 if billing != "platform" else sum_platform_tokens_month(wid)
    cap = int(policy["monthly_token_cap"])
    applies = billing == "platform"
    remaining = max(0, cap - used) if applies else cap
    percent = 0
    if applies and cap > 0:
        percent = min(100, int(round(100 * used / cap)))
    elif applies and used > 0:
        percent = 100
    blocked = applies and (bool(policy["paused"]) or used >= cap)
    warn = applies and not blocked and cap > 0 and used >= int(cap * WARN_RATIO)
    if policy["paused"] and not is_internal_workspace(wid) and billing != "exempt":
        blocked = True
    return {
        "workspace_id": wid,
        "billing": billing,
        "applies": applies,
        "exempt": billing == "exempt",
        "own_key": billing == "own",
        "paused": bool(policy["paused"]) and billing != "exempt",
        "monthly_token_cap": cap,
        "tokens_used_month": used,
        "tokens_remaining": remaining if applies else None,
        "percent": percent,
        "warn": warn,
        "blocked": blocked if billing != "exempt" else False,
        "renews_on": next_renewal_label(),
    }


def assert_call_allowed(workspace_id: str | None = None) -> str:
    """À appeler avant chaque requête LLM. Mémorise la source pour le journal d'usage."""
    from tenant_context import get_workspace_id
    from workspace_db import ws_id

    wid = (workspace_id or get_workspace_id() or ws_id() or "").strip()
    billing = resolve_billing_source(wid)
    _billing_source.set(billing)
    if billing == "exempt":
        return billing
    policy = _policy_row(wid)
    if policy["paused"]:
        raise LlmEnvelopeError(PAUSED_MESSAGE)
    if billing == "own":
        return billing
    used = sum_platform_tokens_month(wid)
    if used >= int(policy["monthly_token_cap"]):
        raise LlmEnvelopeError(EXHAUSTED_MESSAGE)
    return billing


def update_envelope_policy(
    workspace_id: str,
    *,
    monthly_token_cap: int | None = None,
    paused: bool | None = None,
) -> dict[str, Any]:
    from database import get_conn
    from workspace_db import _ensure_workspace_public_columns, get_workspace_by_id

    wid = (workspace_id or "").strip()
    if not get_workspace_by_id(wid):
        raise ValueError("Espace introuvable.")
    if is_internal_workspace(wid):
        raise ValueError("L'espace interne n'est pas soumis à l'enveloppe.")
    sets: list[str] = []
    vals: list[Any] = []
    if monthly_token_cap is not None:
        cap = int(monthly_token_cap)
        if cap < 0 or cap > _MAX_CAP:
            raise ValueError(f"Le plafond doit être entre 0 et {_MAX_CAP}.")
        sets.append("llm_monthly_token_cap = ?")
        vals.append(cap)
    if paused is not None:
        sets.append("llm_paused = ?")
        vals.append(1 if paused else 0)
    if sets:
        vals.append(wid)
        with get_conn() as conn:
            _ensure_workspace_public_columns(conn)
            conn.execute(f"UPDATE korymb_workspaces SET {', '.join(sets)} WHERE id = ?", tuple(vals))
            conn.commit()
    return envelope_status(wid)


def list_instance_envelopes() -> list[dict[str, Any]]:
    from database import get_conn, _ensure_llm_usage_table
    from workspace_db import _ensure_workspace_public_columns

    start = month_start_utc()
    usage: dict[str, dict[str, Any]] = {}
    with get_conn() as conn:
        _ensure_workspace_public_columns(conn)
        _ensure_llm_usage_table(conn)
        rows = conn.execute(
            "SELECT w.id, w.name, w.slug, w.created_at, w.archived_at, w.starter_pack_id, "
            "w.llm_monthly_token_cap, w.llm_paused, "
            "u.email AS owner_email, u.display_name AS owner_name "
            "FROM korymb_workspaces w "
            "LEFT JOIN korymb_users u ON u.id = w.owner_user_id "
            "ORDER BY w.created_at ASC"
        ).fetchall()
        agg = conn.execute(
            "SELECT workspace_id, "
            "COALESCE(SUM(CASE WHEN billing_source = 'platform' AND substr(created_at, 1, 10) >= ? "
            "THEN tokens_in + tokens_out ELSE 0 END), 0) AS platform_month, "
            "MAX(created_at) AS last_call "
            "FROM llm_usage_events GROUP BY workspace_id",
            (start,),
        ).fetchall()
    for item in agg or []:
        d = dict(item)
        usage[str(d.get("workspace_id") or "")] = d
    out: list[dict[str, Any]] = []
    for row in rows or []:
        base = dict(row)
        wid = str(base.get("id") or "")
        stats = usage.get(wid) or {}
        status = envelope_status(wid)
        status["name"] = base.get("name") or ""
        status["slug"] = base.get("slug") or ""
        status["owner_email"] = base.get("owner_email") or ""
        status["owner_name"] = base.get("owner_name") or ""
        status["archived_at"] = str(base.get("archived_at") or "")
        status["starter_pack_id"] = str(base.get("starter_pack_id") or "")
        status["last_call_at"] = stats.get("last_call") or ""
        if status["billing"] == "platform":
            try:
                status["tokens_used_month"] = int(stats.get("platform_month") or 0)
            except (TypeError, ValueError):
                pass
            cap = int(status["monthly_token_cap"])
            used = int(status["tokens_used_month"])
            status["tokens_remaining"] = max(0, cap - used)
            status["percent"] = min(100, int(round(100 * used / cap))) if cap > 0 else (100 if used else 0)
            status["warn"] = (not status["paused"]) and cap > 0 and used >= int(cap * WARN_RATIO) and used < cap
            status["blocked"] = bool(status["paused"]) or used >= cap
        out.append(status)
    return out
