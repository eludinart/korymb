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
