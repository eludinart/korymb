"""Attente HITL : Event in-process + poll espacé en repli (multi-worker / restart)."""
from __future__ import annotations

import threading
import time
from typing import Any

from database import get_job as db_get_job
from state import KorymbJobCancelled, raise_if_job_cancelled as _raise_if_job_cancelled

_lock = threading.Lock()
_events: dict[str, threading.Event] = {}


def _event_for(job_id: str) -> threading.Event:
    jid = (job_id or "").strip()
    with _lock:
        ev = _events.get(jid)
        if ev is None:
            ev = threading.Event()
            _events[jid] = ev
        return ev


def notify_hitl_resolved(job_id: str) -> None:
    """À appeler après résolution HITL persistée — réveille les waiters du même process."""
    jid = (job_id or "").strip()
    if not jid:
        return
    with _lock:
        ev = _events.get(jid)
        if ev is None:
            ev = threading.Event()
            _events[jid] = ev
        ev.set()


def clear_hitl_wait(job_id: str) -> None:
    jid = (job_id or "").strip()
    if not jid:
        return
    with _lock:
        ev = _events.pop(jid, None)
        if ev is not None:
            ev.set()


def _read_resolution(job_id: str, job_logs: list | None) -> dict[str, Any] | None:
    """None = encore en attente ; dict = décision ; lève si cancelled."""
    _raise_if_job_cancelled(job_id)
    row = db_get_job(job_id)
    if not row:
        return None
    st = str(row.get("status") or "")
    if st == "awaiting_validation":
        return None
    if st == "cancelled":
        if job_logs is not None:
            job_logs.append("[korymb] Plan CIO — rejet ou annulation dirigeant (HITL).")
        raise KorymbJobCancelled()
    if st == "running":
        res = row.get("hitl_resolution")
        if isinstance(res, dict) and res.get("decision") == "amend" and isinstance(res.get("amended_plan"), dict):
            return res
        return {"decision": "approve"}
    return None


def wait_for_cio_plan_hitl_resolution(job_id: str, job_logs: list | None = None) -> dict[str, Any]:
    """
    Bloque jusqu'à résolution HITL (approve / reject / amend) pour le plan CIO.

    Préfère un Event in-process (réveil immédiat après notify_hitl_resolved).
    Repli : lecture DB à intervalle espacé (multi-worker / process redémarré).
    """
    from database import get_behavior_setting
    from services.behavior_defaults import behavior_default_value

    def _bi(key: str, default: int) -> int:
        raw = get_behavior_setting(key)
        if raw is None:
            raw = behavior_default_value(key)
        try:
            return int(raw if raw is not None else default)
        except (TypeError, ValueError):
            return default

    def _bf(key: str, default: float) -> float:
        raw = get_behavior_setting(key)
        if raw is None:
            raw = behavior_default_value(key)
        try:
            return float(raw if raw is not None else default)
        except (TypeError, ValueError):
            return default

    max_wait_s = float(_bi("orchestration.cio.hitl_wait_max_seconds", 7200))
    poll_interval = float(_bf("orchestration.cio.hitl_poll_interval_seconds", 2.0))
    if poll_interval <= 0:
        poll_interval = 2.0
    if max_wait_s > 86400:
        max_wait_s = max_wait_s * poll_interval

    ev = _event_for(job_id)
    ev.clear()
    deadline = time.monotonic() + max_wait_s
    tick = 0
    while True:
        outcome = _read_resolution(job_id, job_logs)
        if outcome is not None:
            clear_hitl_wait(job_id)
            return outcome
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        wait_s = min(poll_interval, remaining)
        ev.wait(timeout=wait_s)
        tick += 1
        if tick > 0 and tick % 30 == 0 and job_logs is not None:
            job_logs.append("[korymb] Toujours en attente de validation du plan CIO (HITL)…")
    raise RuntimeError("Délai dépassé en attente de validation du plan CIO (HITL).")
