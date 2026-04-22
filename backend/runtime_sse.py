"""Signaux temps réel pour /events/stream (réveil + file d'événements mission)."""
from __future__ import annotations

import threading
from collections import deque
from typing import Any

RUNTIME_SSE_WAKE = threading.Event()
_JOB_SSE_QUEUE: deque[dict[str, Any]] = deque(maxlen=200)


def enqueue_job_sse_event(payload: dict[str, Any]) -> None:
    """Appelé depuis le worker synchrone quand une mission émet un événement."""
    _JOB_SSE_QUEUE.append(payload)
    RUNTIME_SSE_WAKE.set()


def drain_job_sse_events() -> list[dict[str, Any]]:
    """Consomme la file (appelé depuis la boucle asyncio du SSE)."""
    drained: list[dict[str, Any]] = []
    while True:
        try:
            drained.append(_JOB_SSE_QUEUE.popleft())
        except IndexError:
            break
    return drained
