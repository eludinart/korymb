from __future__ import annotations

from typing import Any


def queue_hitl_validation(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Hook phase 1 pour une future integration Telegram.
    Retourne une enveloppe stable sans faire d'appel reseau.
    """
    return {
        "channel": "telegram",
        "status": "queued_stub",
        "requires_human_validation": True,
        "payload": payload,
    }

