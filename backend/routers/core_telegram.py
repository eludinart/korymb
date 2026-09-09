"""Webhook Telegram — callbacks Valider / Rejeter (bot HITL dédié)."""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Header, HTTPException, Request

from tenant_context import set_tenant_context

logger = logging.getLogger(__name__)
router = APIRouter(tags=["telegram"])


def _webhook_secret() -> str:
    return (
        os.getenv("TELEGRAM_WEBHOOK_SECRET")
        or os.getenv("TELEGRAM_HITL_WEBHOOK_SECRET")
        or ""
    ).strip()


@router.post("/telegram/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    expected = _webhook_secret()
    env = (os.getenv("ENV") or "").strip().lower()
    if expected and (x_telegram_bot_api_secret_token or "") != expected:
        raise HTTPException(status_code=403, detail="Secret Telegram invalide.")
    if not expected and env not in ("development", "test", "dev"):
        raise HTTPException(status_code=403, detail="TELEGRAM_WEBHOOK_SECRET manquant.")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="JSON invalide.") from None
    if not isinstance(body, dict):
        return {"ok": True}

    cq = body.get("callback_query") if isinstance(body.get("callback_query"), dict) else None
    if not cq:
        return {"ok": True, "ignored": True}

    data = str(cq.get("data") or "").strip()
    callback_id = str(cq.get("id") or "")
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "k" or parts[1] not in ("a", "r"):
        return {"ok": True, "ignored": True}

    decision = "approve" if parts[1] == "a" else "reject"
    ticket_id = parts[2]
    from services.action_queue import get_action_unscoped, resolve_action
    from services.action_telegram import answer_callback

    ticket = get_action_unscoped(ticket_id)
    if not ticket:
        answer_callback(callback_id, "Ticket introuvable")
        return {"ok": False, "error": "not_found"}

    set_tenant_context(workspace_id=str(ticket.get("workspace_id") or "ws-default-legacy"))
    result = resolve_action(ticket_id, decision=decision, source="telegram")
    if result.get("success"):
        msg = "Exécuté." if decision == "approve" else "Rejeté."
        if result.get("ticket", {}).get("status") == "executed":
            msg = "Validé et exécuté."
        answer_callback(callback_id, msg)
        return {"ok": True, "ticket_id": ticket_id, "decision": decision}
    err = str(result.get("error") or "échec")[:180]
    answer_callback(callback_id, err)
    code = int(result.get("status_code") or 400)
    if code in (404, 409):
        return {"ok": False, "error": err, "status_code": code}
    raise HTTPException(status_code=code, detail=err)
