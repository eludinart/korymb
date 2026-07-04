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
