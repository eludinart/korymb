"""Tests attente HITL Event + notify."""
from __future__ import annotations

import threading
import time


def test_hitl_wait_wakes_on_notify(monkeypatch):
    from services import hitl_wait as hw

    job_id = "job-hitl-wait-test"
    calls = {"n": 0}

    def fake_get_job(jid):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"status": "awaiting_validation"}
        return {"status": "running", "hitl_resolution": {"decision": "approve"}}

    monkeypatch.setattr(hw, "db_get_job", fake_get_job)
    monkeypatch.setattr(hw, "_raise_if_job_cancelled", lambda jid: None)
    monkeypatch.setattr(
        "database.get_behavior_setting",
        lambda key: {
            "orchestration.cio.hitl_wait_max_seconds": 30,
            "orchestration.cio.hitl_poll_interval_seconds": 5.0,
        }.get(key),
    )
    monkeypatch.setattr(
        "services.behavior_defaults.behavior_default_value",
        lambda key: {
            "orchestration.cio.hitl_wait_max_seconds": 30,
            "orchestration.cio.hitl_poll_interval_seconds": 5.0,
        }.get(key),
    )

    result_box: dict = {}

    def waiter():
        result_box["out"] = hw.wait_for_cio_plan_hitl_resolution(job_id, [])

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    time.sleep(0.05)
    assert hw.has_hitl_waiter(job_id)
    hw.notify_hitl_resolved(job_id)
    t.join(timeout=3)
    assert not t.is_alive()
    assert result_box.get("out", {}).get("decision") == "approve"
    assert not hw.has_hitl_waiter(job_id)
