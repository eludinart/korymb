"""La tâche planifiée ne doit pas occuper la boucle qui sert /health/live."""
from __future__ import annotations

import asyncio
import threading


def test_run_task_by_id_leaves_the_event_loop(monkeypatch):
    import scheduler

    seen: dict[str, object] = {}

    def _fake(task_id: str) -> None:
        seen["id"] = task_id
        seen["off_loop"] = threading.current_thread() is not threading.main_thread()

    monkeypatch.setattr(scheduler, "execute_scheduled_task", _fake)
    asyncio.run(scheduler.run_task_by_id("task-1"))
    assert seen["id"] == "task-1"
    assert seen["off_loop"] is True


def test_gmail_sync_runs_without_an_event_loop(monkeypatch):
    import scheduler

    monkeypatch.setattr(
        "database.get_scheduled_task_any",
        lambda task_id: {
            "id": task_id,
            "workspace_id": "ws-1",
            "enabled": True,
            "task_type": "gmail_prospect_sync",
        },
    )
    monkeypatch.setattr("database.update_scheduled_task", lambda *args, **kwargs: None)
    monkeypatch.setattr("tenant_context.set_tenant_context", lambda **kwargs: None)
    seen: list[str] = []

    def _sync(task: dict) -> None:
        seen.append(str(task.get("id")))

    monkeypatch.setattr("services.email_prospecting.run_gmail_prospect_sync_blocking", _sync)
    scheduler.execute_scheduled_task("task-gmail")
    assert seen == ["task-gmail"]
