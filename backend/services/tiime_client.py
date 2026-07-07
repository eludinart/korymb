"""
tiime_client.py — Pont Korymb → Tiime (facturation électronique externe).

Tiime n'expose pas d'API publique documentée pour tous les plans.
Stratégie :
  1. Webhook Make/Tiime Business (TIIME_MAKE_WEBHOOK_URL) si configuré
  2. Sinon mode manuel : lien app.tiime.fr + enregistrement de la référence facture
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any
from urllib import error, request

logger = logging.getLogger(__name__)

TIIME_APP_URL = "https://app.tiime.fr/"


def _webhook_url() -> str:
    return (os.getenv("TIIME_MAKE_WEBHOOK_URL") or os.getenv("TIIME_WEBHOOK_URL") or "").strip()


def is_tiime_automation_configured() -> bool:
    return bool(_webhook_url())


def build_quote_payload_for_tiime(quote: dict, contact: dict | None = None) -> dict[str, Any]:
    """Normalise un devis Korymb pour envoi Make / Tiime Apps."""
    lines_out = []
    for line in quote.get("lines") or []:
        lines_out.append({
            "label": line.get("label") or "",
            "quantity": float(line.get("qty") or 1),
            "unit_price_eur": round(int(line.get("unit_price_cents") or 0) / 100, 2),
            "tax_rate": float(line.get("tax_rate") or 0),
        })
    return {
        "source": "korymb",
        "action": "create_invoice_from_quote",
        "quote": {
            "id": quote.get("id"),
            "number": quote.get("quote_number"),
            "title": quote.get("title"),
            "status": quote.get("status"),
            "currency": quote.get("currency") or "EUR",
            "subtotal_eur": round(int(quote.get("subtotal_cents") or 0) / 100, 2),
            "tax_eur": round(int(quote.get("tax_cents") or 0) / 100, 2),
            "total_eur": round(int(quote.get("total_cents") or 0) / 100, 2),
            "valid_until": quote.get("valid_until"),
            "notes": quote.get("notes") or "",
            "lines": lines_out,
        },
        "contact": {
            "id": (contact or {}).get("id"),
            "name": (contact or {}).get("name") or "",
            "email": (contact or {}).get("email") or "",
            "phone": (contact or {}).get("phone") or "",
            "company": (contact or {}).get("company") or "",
        }
        if contact
        else None,
        "project_id": quote.get("project_id"),
    }


def request_tiime_invoice(quote: dict, contact: dict | None = None) -> dict[str, Any]:
    """
    Tente d'envoyer le devis vers Tiime via webhook.
    Retourne toujours un dict avec mode, instructions et payload.
    """
    payload = build_quote_payload_for_tiime(quote, contact)
    webhook = _webhook_url()

    if not webhook:
        return {
            "mode": "manual",
            "success": False,
            "tiime_app_url": TIIME_APP_URL,
            "message": (
                "Créez la facture dans Tiime à partir du devis accepté, puis enregistrez la référence "
                "dans Korymb. Pour automatiser : configurez TIIME_MAKE_WEBHOOK_URL (Make + Tiime Business)."
            ),
            "payload": payload,
        }

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(raw) if raw.strip() else {}
            except json.JSONDecodeError:
                data = {"raw": raw[:2000]}
            return {
                "mode": "webhook",
                "success": 200 <= int(getattr(resp, "status", 200)) < 300,
                "status_code": int(getattr(resp, "status", 200)),
                "tiime_app_url": TIIME_APP_URL,
                "message": "Demande envoyée au connecteur Make/Tiime.",
                "response": data,
                "payload": payload,
            }
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1500]
        logger.warning("Tiime webhook HTTP %s: %s", exc.code, detail)
        return {
            "mode": "webhook",
            "success": False,
            "status_code": exc.code,
            "tiime_app_url": TIIME_APP_URL,
            "message": f"Échec webhook Tiime (HTTP {exc.code}). Créez la facture manuellement dans Tiime.",
            "error": detail,
            "payload": payload,
        }
    except Exception as exc:
        logger.warning("Tiime webhook error: %s", exc)
        return {
            "mode": "webhook",
            "success": False,
            "tiime_app_url": TIIME_APP_URL,
            "message": f"Webhook Tiime injoignable ({exc}). Mode manuel : ouvrez Tiime.",
            "error": str(exc),
            "payload": payload,
        }
