"""Portefeuille d'instance : signaux, cycle de vie, file à traiter, entrée transverse."""
from __future__ import annotations

import uuid
from datetime import datetime


def _register(client, email: str, workspace: str) -> tuple[str, str]:
    res = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "secretpass123",
            "display_name": "Test",
            "workspace_name": workspace,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    return body["token"], body["workspace"]["id"]


def _auth(token: str, workspace_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    return headers


def _insert_job(workspace_id: str, *, status: str, mission: str) -> str:
    from database import get_conn

    job_id = f"job-{uuid.uuid4().hex[:12]}"
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO jobs (id, agent, mission, status, source, created_at, updated_at, workspace_id) "
            "VALUES (?, ?, ?, ?, 'mission', ?, ?, ?)",
            (job_id, "cio", mission, status, now, now, workspace_id),
        )
        conn.commit()
    return job_id


def test_client_cannot_read_portfolio(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "port-owner@example.com")
    token, _wid = _register(client, "port-client@example.com", "Client Portefeuille")
    denied = client.get("/platform/portfolio", headers=_auth(token))
    assert denied.status_code == 403


def test_owner_sees_signals_and_attention(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "port-owner-b@example.com")
    owner_token, _owner_ws = _register(client, "port-owner-b@example.com", "QG Owner")
    _client_token, client_ws = _register(client, "port-client-b@example.com", "Atelier Signal")
    mission = f"Valider le devis {uuid.uuid4().hex[:6]}"
    _insert_job(client_ws, status="awaiting_validation", mission=mission)
    _insert_job(client_ws, status="running", mission="Mission en cours")

    listed = client.get("/platform/portfolio", headers=_auth(owner_token))
    assert listed.status_code == 200, listed.text
    card = next(row for row in listed.json()["spaces"] if row["workspace_id"] == client_ws)
    assert card["needs_you"] >= 1
    assert card["in_progress"] >= 1
    assert card["state"] == "a_traiter"
    assert card["protected"] is False

    queue = client.get("/platform/attention", headers=_auth(owner_token))
    assert queue.status_code == 200, queue.text
    titles = [item["title"] for item in queue.json()["items"] if item["workspace_id"] == client_ws]
    assert mission in titles


def test_create_rename_pause_archive_delete(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "port-owner-c@example.com")
    owner_token, _owner_ws = _register(client, "port-owner-c@example.com", "QG Cycle")
    headers = _auth(owner_token)

    created = client.post(
        "/platform/workspaces",
        headers=headers,
        json={"name": "Client Cycle", "starter_pack_id": "accompagnement"},
    )
    assert created.status_code == 200, created.text
    wid = created.json()["workspace_id"]
    assert created.json()["name"] == "Client Cycle"
    assert created.json()["starter_pack_id"] == "accompagnement"

    renamed = client.patch(
        f"/platform/workspaces/{wid}",
        headers=headers,
        json={"name": "Client Renommé", "paused": True},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Client Renommé"
    assert renamed.json()["paused"] is True
    assert renamed.json()["state"] == "bloque"

    too_soon = client.post(
        f"/platform/workspaces/{wid}/delete",
        headers=headers,
        json={"confirm_name": "Client Renommé"},
    )
    assert too_soon.status_code == 400

    archived = client.post(f"/platform/workspaces/{wid}/archive", headers=headers)
    assert archived.status_code == 200, archived.text
    assert archived.json()["state"] == "archive"

    hidden = client.get("/platform/attention", headers=headers)
    assert all(item["workspace_id"] != wid or item["kind"] == "envelope" for item in hidden.json()["items"])

    mismatch = client.post(
        f"/platform/workspaces/{wid}/delete",
        headers=headers,
        json={"confirm_name": "autre nom"},
    )
    assert mismatch.status_code == 400

    removed = client.post(
        f"/platform/workspaces/{wid}/delete",
        headers=headers,
        json={"confirm_name": "Client Renommé"},
    )
    assert removed.status_code == 200, removed.text
    again = client.get("/platform/portfolio", headers=headers)
    assert all(row["workspace_id"] != wid for row in again.json()["spaces"])


def test_legacy_space_is_protected(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "port-owner-d@example.com")
    owner_token, _wid = _register(client, "port-owner-d@example.com", "QG Legacy")
    headers = _auth(owner_token)
    listed = client.get("/platform/portfolio", headers=headers)
    legacy = next(row for row in listed.json()["spaces"] if row["workspace_id"] == "ws-default-legacy")
    assert legacy["protected"] is True
    paused = client.patch(
        "/platform/workspaces/ws-default-legacy",
        headers=headers,
        json={"paused": True},
    )
    assert paused.status_code == 400
    archived = client.post("/platform/workspaces/ws-default-legacy/archive", headers=headers)
    assert archived.status_code == 400


def test_owner_opens_foreign_space_without_membership(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "port-owner-e@example.com")
    owner_token, _owner_ws = _register(client, "port-owner-e@example.com", "QG Entree")
    client_token, client_ws = _register(client, "port-client-e@example.com", "Espace Etranger")

    blocked = client.get("/auth/me", headers=_auth(client_token, _owner_ws))
    assert blocked.status_code == 403

    opened = client.post(f"/platform/workspaces/{client_ws}/open", headers=_auth(owner_token))
    assert opened.status_code == 200, opened.text
    me = client.get("/auth/me", headers=_auth(owner_token, client_ws))
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["workspace"]["id"] == client_ws
    assert body["role"] == "admin"
    assert body["is_platform_owner"] is True
    assert body["home_workspace_id"] == "ws-default-legacy"
    assert body["visiting_client_space"] is True

    client_me = client.get("/auth/me", headers=_auth(client_token))
    assert client_me.status_code == 200, client_me.text
    client_body = client_me.json()
    assert client_body["is_platform_owner"] is False
    assert client_body["visiting_client_space"] is False
    assert client_body["home_workspace_id"] is None


def test_restore_brings_space_back(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "port-owner-f@example.com")
    owner_token, _wid = _register(client, "port-owner-f@example.com", "QG Restore")
    headers = _auth(owner_token)
    created = client.post("/platform/workspaces", headers=headers, json={"name": "Client Pause Liste"})
    assert created.status_code == 200, created.text
    wid = created.json()["workspace_id"]
    assert client.post(f"/platform/workspaces/{wid}/archive", headers=headers).status_code == 200
    restored = client.post(f"/platform/workspaces/{wid}/restore", headers=headers)
    assert restored.status_code == 200, restored.text
    assert restored.json()["state"] != "archive"
    assert restored.json()["archived_at"] == ""
