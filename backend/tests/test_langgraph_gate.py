"""Le second cerveau est le chemin normal, avec repli et journal."""
from __future__ import annotations


def test_langgraph_is_the_default_without_a_flag(monkeypatch):
    monkeypatch.delenv("KORYMB_ALLOW_LANGGRAPH", raising=False)
    monkeypatch.setattr("database.get_behavior_setting", lambda key: None)
    from graph.engine import get_orchestration_engine, use_langgraph_execution

    assert get_orchestration_engine() == "langgraph"
    assert use_langgraph_execution() is True


def test_legacy_stays_available_when_chosen(monkeypatch):
    monkeypatch.setattr(
        "database.get_behavior_setting",
        lambda key: "legacy" if key == "orchestration.engine" else None,
    )
    from graph.engine import get_orchestration_engine, use_langgraph_execution

    assert get_orchestration_engine() == "legacy"
    assert use_langgraph_execution() is False


def test_behavior_put_accepts_langgraph(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "lg-open@example.com",
            "password": "secretpass123",
            "workspace_name": "LG Open",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    r = client.put(
        "/admin/behavior-settings/orchestration.engine",
        headers={"Authorization": f"Bearer {token}", "X-Agent-Secret": ""},
        json={"value": "langgraph"},
    )
    assert r.status_code == 200, r.text


def test_resume_without_a_paused_graph_does_nothing(app):
    from graph.runner import resume_mission_graph

    assert resume_mission_graph("job-sans-carnet", {"decision": "approve"}) is None


def test_existing_legacy_engine_is_promoted_once(app):
    from database import get_behavior_setting, promote_brain_engine_once, upsert_behavior_setting

    upsert_behavior_setting("orchestration.engine", "legacy")
    upsert_behavior_setting("_brain_promoted", False)
    promote_brain_engine_once()
    assert get_behavior_setting("orchestration.engine") == "langgraph"
    upsert_behavior_setting("orchestration.engine", "legacy")
    promote_brain_engine_once()
    assert get_behavior_setting("orchestration.engine") == "legacy"
