from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)


def queue_hitl_validation(payload: dict[str, Any]) -> dict[str, Any]:
    """Hook legacy — délègue aussi aux canaux externes si configurés."""
    dispatch_external_notification(
        kind="hitl",
        title="Validation HITL requise",
        body=str(payload.get("mission") or "")[:500],
        job_id=str(payload.get("job_id") or "") or None,
        action_url=f"/inbox?job={payload.get('job_id')}" if payload.get("job_id") else None,
    )
    return {
        "channel": "in_app",
        "status": "queued",
        "requires_human_validation": True,
        "payload": payload,
    }


def dispatch_external_notification(
    *,
    kind: str,
    title: str,
    body: str = "",
    job_id: str | None = None,
    output_id: str | None = None,
    action_url: str | None = None,
) -> dict[str, Any]:
    """
    Canaux externes (phase 5) : email + webhook.
    Appelé après insert director_notifications ou depuis HITL hook.
    """
    from runtime_settings import merge_with_env

    cfg = merge_with_env()
    results: dict[str, Any] = {"email": "skipped", "webhook": "skipped"}

    email_to = str(cfg.get("notification.email_to") or os.getenv("NOTIFICATION_EMAIL_TO") or "").strip()
    webhook_url = str(cfg.get("notification.webhook_url") or os.getenv("NOTIFICATION_WEBHOOK_URL") or "").strip()

    signed_url = _signed_action_url(action_url, job_id=job_id, output_id=output_id)

    if email_to:
        try:
            _send_email_stub(email_to, title, body, signed_url)
            results["email"] = "sent_stub"
        except Exception as exc:
            logger.warning("Email notification failed: %s", exc)
            results["email"] = f"error:{exc}"

    if webhook_url:
        try:
            payload = {
                "kind": kind,
                "title": title,
                "body": body,
                "job_id": job_id,
                "output_id": output_id,
                "action_url": action_url,
                "signed_action_url": signed_url,
            }
            req = urllib.request.Request(
                webhook_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                results["webhook"] = resp.status
        except Exception as exc:
            logger.warning("Webhook notification failed: %s", exc)
            results["webhook"] = f"error:{exc}"

    return results


def _signed_action_url(action_url: str | None, *, job_id: str | None, output_id: str | None) -> str | None:
    if not action_url:
        return None
    secret = (os.getenv("AGENT_API_SECRET") or os.getenv("KORYMB_AGENT_SECRET") or "").strip()
    if not secret:
        return action_url
    token_payload = json.dumps({"job_id": job_id, "output_id": output_id}, sort_keys=True)
    sig = hmac.new(secret.encode(), token_payload.encode(), hashlib.sha256).hexdigest()[:32]
    sep = "&" if "?" in action_url else "?"
    return f"{action_url}{sep}token={sig}"


def _send_email_stub(to: str, subject: str, body: str, action_url: str | None) -> None:
    """Stub SMTP — log only until SMTP config is wired."""
    logger.info("EMAIL stub → %s | %s | %s | %s", to, subject, body[:200], action_url or "")
