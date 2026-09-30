"""Garde-fou LangGraph : gelé sans KORYMB_ALLOW_LANGGRAPH."""
from __future__ import annotations


def test_langgraph_engine_forced_legacy_without_allow(monkeypatch):
    monkeypatch.delenv("KORYMB_ALLOW_LANGGRAPH", raising=False)
    monkeypatch.setattr(
        "database.get_behavior_setting",
        lambda key: "langgraph" if key == "orchestration.engine" else None,
    )
    from graph.engine import get_orchestration_engine, use_langgraph_execution

    assert get_orchestration_engine() == "legacy"
    assert use_langgraph_execution() is False


def test_langgraph_engine_allowed_with_flag(monkeypatch):
    monkeypatch.setenv("KORYMB_ALLOW_LANGGRAPH", "1")
    monkeypatch.setattr(
        "database.get_behavior_setting",
        lambda key: "langgraph" if key == "orchestration.engine" else None,
    )
    from graph.engine import get_orchestration_engine, use_langgraph_execution

    assert get_orchestration_engine() == "langgraph"
    assert use_langgraph_execution() is True


def test_behavior_put_rejects_langgraph_without_allow(client, monkeypatch):
    monkeypatch.delenv("KORYMB_ALLOW_LANGGRAPH", raising=False)
    reg = client.post(
        "/auth/register",
        json={
            "email": "lg-gate@example.com",
            "password": "secretpass123",
            "workspace_name": "LG Gate",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    r = client.put(
        "/admin/behavior-settings/orchestration.engine",
        headers={"Authorization": f"Bearer {token}", "X-Agent-Secret": ""},
        json={"value": "langgraph"},
    )
    assert r.status_code == 400
