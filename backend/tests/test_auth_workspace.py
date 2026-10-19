"""Auth multi-tenant : inscription, connexion, isolation workspace."""
from __future__ import annotations


def test_auth_register_login_and_me(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "saas-test@example.com",
            "password": "secretpass123",
            "display_name": "Test SaaS",
            "workspace_name": "Espace Test",
        },
    )
    assert reg.status_code == 200, reg.text
    body = reg.json()
    assert body.get("token")
    assert body.get("workspace", {}).get("name") == "Espace Test"
    token = body["token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    profile = me.json()
    assert profile.get("user", {}).get("email") == "saas-test@example.com"
    assert profile.get("role") == "admin"

    login = client.post(
        "/auth/login",
        json={"email": "saas-test@example.com", "password": "secretpass123"},
    )
    assert login.status_code == 200
    assert login.json().get("token")


def test_login_audience_separates_operator_and_subscriber(client):
    client.post(
        "/auth/register",
        json={
            "email": "ops-login@example.com",
            "password": "secretpass123",
            "workspace_name": "Ops Login",
        },
    )
    patch = client.post(
        "/auth/login",
        json={"email": "ops-login@example.com", "password": "secretpass123", "audience": "operator"},
    )
    assert patch.status_code == 200, patch.text
    slug = patch.json()["workspace"]["slug"]
    client.patch(
        "/storefront/settings",
        headers={"Authorization": f"Bearer {patch.json()['token']}"},
        json={"public_enabled": True},
    )
    sub = client.post(
        "/auth/register-subscriber",
        json={
            "email": "part-login@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    assert sub.status_code == 200, sub.text
    wrong_op = client.post(
        "/auth/login",
        json={"email": "part-login@example.com", "password": "secretpass123", "audience": "operator"},
    )
    assert wrong_op.status_code == 403
    wrong_sub = client.post(
        "/auth/login",
        json={
            "email": "ops-login@example.com",
            "password": "secretpass123",
            "audience": "subscriber",
            "workspace_id": slug,
        },
    )
    assert wrong_sub.status_code == 403
    ok_sub = client.post(
        "/auth/login",
        json={
            "email": "part-login@example.com",
            "password": "secretpass123",
            "audience": "subscriber",
            "workspace_id": slug,
        },
    )
    assert ok_sub.status_code == 200
    assert ok_sub.json().get("role") == "subscriber"


def test_workspace_job_isolation(client):
    reg_a = client.post(
        "/auth/register",
        json={
            "email": "tenant-a@example.com",
            "password": "secretpass123",
            "workspace_name": "Tenant A",
        },
    )
    reg_b = client.post(
        "/auth/register",
        json={
            "email": "tenant-b@example.com",
            "password": "secretpass123",
            "workspace_name": "Tenant B",
        },
    )
    token_a = reg_a.json()["token"]
    token_b = reg_b.json()["token"]

    run_a = client.post(
        "/run",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"agent": "coordinateur", "mission": "Mission visible A uniquement", "source": "test"},
    )
    assert run_a.status_code == 200
    job_id = run_a.json().get("job_id")
    assert job_id

    jobs_b = client.get("/jobs/light", headers={"Authorization": f"Bearer {token_b}"})
    assert jobs_b.status_code == 200
    payload = jobs_b.json()
    rows = payload.get("jobs") if isinstance(payload, dict) else payload
    ids_b = {str(j.get("id") or j.get("job_id") or "") for j in rows if isinstance(j, dict)}
    assert job_id not in ids_b


def test_user_can_change_password(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "mdp-change@example.com",
            "password": "secretpass123",
            "display_name": "Mdp",
            "workspace_name": "Mdp WS",
        },
    )
    token = reg.json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    bad = client.patch(
        "/auth/profile",
        headers=auth,
        json={"current_password": "wrongpass1", "new_password": "nouveau123"},
    )
    assert bad.status_code == 400
    ok = client.patch(
        "/auth/profile",
        headers=auth,
        json={"current_password": "secretpass123", "new_password": "nouveau123"},
    )
    assert ok.status_code == 200, ok.text
    login = client.post(
        "/auth/login",
        json={"email": "mdp-change@example.com", "password": "nouveau123"},
    )
    assert login.status_code == 200, login.text


def test_subscriber_cannot_open_workspace_or_list_team(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "ops-gate@example.com",
            "password": "secretpass123",
            "workspace_name": "Equipe Gate",
        },
    )
    assert reg.status_code == 200, reg.text
    admin_token = reg.json()["token"]
    admin_auth = {"Authorization": f"Bearer {admin_token}"}
    slug = reg.json()["workspace"]["slug"]
    published = client.patch(
        "/storefront/settings",
        headers=admin_auth,
        json={"public_enabled": True},
    )
    assert published.status_code == 200, published.text

    team = client.get("/auth/members", headers=admin_auth)
    assert team.status_code == 200, team.text
    emails = {str(m.get("email") or "") for m in team.json().get("members") or []}
    assert "ops-gate@example.com" in emails

    sub = client.post(
        "/auth/register-subscriber",
        json={
            "email": "part-gate@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    assert sub.status_code == 200, sub.text
    sub_auth = {"Authorization": f"Bearer {sub.json()['token']}"}

    created = client.post(
        "/auth/workspaces",
        headers=sub_auth,
        json={"name": "Espace pirate"},
    )
    assert created.status_code == 403, created.text

    listed = client.get("/auth/members", headers=sub_auth)
    assert listed.status_code == 403, listed.text

    me = client.get("/auth/me", headers=sub_auth)
    assert me.status_code == 200, me.text
    body = me.json()
    assert body.get("role") == "subscriber"
    assert body.get("members") == []
