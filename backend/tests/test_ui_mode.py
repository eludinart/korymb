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


def test_member_cannot_patch_ui_mode(client):
    admin = client.post(
        "/auth/register",
        json={
            "email": "ui-owner@example.com",
            "password": "secretpass123",
            "workspace_name": "UI Owner WS",
        },
    )
    assert admin.status_code == 200, admin.text
    workspace_id = admin.json()["workspace"]["id"]
    admin_headers = {"Authorization": f"Bearer {admin.json()['token']}"}

    member = client.post(
        "/auth/register",
        json={
            "email": "ui-member@example.com",
            "password": "secretpass123",
            "workspace_name": "UI Member Own WS",
        },
    )
    assert member.status_code == 200, member.text

    invited = client.post(
        "/auth/members",
        headers=admin_headers,
        json={"email": "ui-member@example.com", "role": "member"},
    )
    assert invited.status_code == 200, invited.text

    login = client.post(
        "/auth/login",
        json={
            "email": "ui-member@example.com",
            "password": "secretpass123",
            "workspace_id": workspace_id,
        },
    )
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "member"
    denied = client.patch(
        "/auth/workspace/ui-mode",
        headers={"Authorization": f"Bearer {login.json()['token']}"},
        json={"ui_mode": "advanced"},
    )
    assert denied.status_code == 403, denied.text
