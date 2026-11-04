"""Canal agent_bus — messages inter-nœuds hors inbox HITL."""
from __future__ import annotations


def test_create_and_list_open_for_grokbot(client):
    created = client.post(
        "/agent-bus/messages",
        json={
            "from": "cursor",
            "to": "grokbot",
            "topic": "mandala-play-review",
            "body": "Surveiller validation Play Store.",
        },
    )
    assert created.status_code == 200, created.text
    msg = created.json()
    assert msg["id"].startswith("bus-")
    assert msg["status"] == "open"
    assert msg["from"] == "cursor"
    assert msg["to"] == "grokbot"

    listed = client.get("/agent-bus/messages", params={"to": "grokbot", "status": "open"})
    assert listed.status_code == 200
    ids = [m["id"] for m in listed.json()["messages"]]
    assert msg["id"] in ids


def test_ack_then_done(client):
    created = client.post(
        "/agent-bus/messages",
        json={
            "from": "cursor",
            "to": "hermes",
            "topic": "smoke",
            "body": "ping",
        },
    ).json()
    mid = created["id"]

    acked = client.post(f"/agent-bus/messages/{mid}/ack")
    assert acked.status_code == 200
    assert acked.json()["status"] == "acked"

    done = client.post(
        f"/agent-bus/messages/{mid}/done",
        json={"comment": "pong"},
    )
    assert done.status_code == 200
    body = done.json()
    assert body["status"] == "done"
    assert "pong" in (body.get("comment") or "")


def test_rejects_unknown_node(client):
    bad = client.post(
        "/agent-bus/messages",
        json={"from": "chatgpt", "to": "cursor", "topic": "x", "body": "nope"},
    )
    assert bad.status_code == 400


def test_agent_bus_not_in_hitl_inbox(client):
    client.post(
        "/agent-bus/messages",
        json={
            "from": "cursor",
            "to": "grokbot",
            "topic": "no-inbox",
            "body": "ne doit pas polluer Décisions",
        },
    )
    inbox = client.get("/admin/inbox")
    assert inbox.status_code == 200
    items = inbox.json().get("items") or []
    assert not any(
        "no-inbox" in str(i.get("title") or "") or "ne doit pas polluer" in str(i.get("body") or "")
        for i in items
    )


def test_plan_to_cursor_creates_task_and_progress(client):
    created = client.post(
        "/agent-bus/messages",
        json={
            "from": "grokbot",
            "to": "cursor",
            "topic": "cursor-task",
            "body": "Plan: brancher le tuyau sans copier-coller.",
        },
    )
    assert created.status_code == 200, created.text
    msg = created.json()
    assert msg.get("task_id")
    mid = msg["id"]

    tasks = client.get("/business/tasks")
    assert tasks.status_code == 200
    rows = tasks.json().get("tasks") or []
    linked = [t for t in rows if t.get("id") == msg["task_id"]]
    assert linked
    assert linked[0]["status"] == "open"
    assert "tuyau" in (linked[0].get("notes") or "")

    prog = client.post(
        f"/agent-bus/messages/{mid}/progress",
        json={"note": "Étape 1 faite (smoke local)."},
    )
    assert prog.status_code == 200, prog.text
    assert "Étape 1" in (prog.json().get("task") or {}).get("notes", "")

    done = client.post(
        f"/agent-bus/messages/{mid}/done",
        json={"comment": "Terminé sans patch hors Cursor."},
    )
    assert done.status_code == 200, done.text
    assert done.json().get("task_id") == msg["task_id"]
    task = client.get(f"/business/tasks/{msg['task_id']}")
    assert task.status_code == 200
    assert task.json()["status"] == "done"
