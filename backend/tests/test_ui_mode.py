"""Préférence ui_mode essential|advanced."""
from __future__ import annotations


def test_new_workspace_defaults_to_essential(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "ui-essential@example.com",
            "password": "secretpass123",
            "workspace_name": "UI Essential WS",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["workspace"]["ui_mode"] == "essential"


def test_patch_ui_mode_to_advanced(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "ui-advanced@example.com",
            "password": "secretpass123",
            "workspace_name": "UI Advanced WS",
        },
    )
    token = reg.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    patch = client.patch("/auth/workspace/ui-mode", headers=headers, json={"ui_mode": "advanced"})
    assert patch.status_code == 200, patch.text
    assert patch.json()["workspace"]["ui_mode"] == "advanced"
    me = client.get("/auth/me", headers=headers)
    assert me.json()["workspace"]["ui_mode"] == "advanced"


def test_patch_ui_mode_rejects_invalid(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "ui-bad@example.com",
            "password": "secretpass123",
            "workspace_name": "UI Bad WS",
        },
    )
    token = reg.json()["token"]
    bad = client.patch(
        "/auth/workspace/ui-mode",
        headers={"Authorization": f"Bearer {token}"},
        json={"ui_mode": "pro"},
    )
    assert bad.status_code == 422
