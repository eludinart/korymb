"""Contrats API : health, llm."""
from __future__ import annotations


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "korymb-backend"
    assert "version" in body
    assert "database" in body


def test_llm_public_shape(client):
    r = client.get("/llm")
    assert r.status_code == 200
    body = r.json()
    assert "provider" in body
    assert "model" in body


def test_health_tools_without_secret(client):
    r = client.get("/health/tools")
    assert r.status_code == 200


def test_admin_settings_requires_secret(app):
    from fastapi.testclient import TestClient

    bare = TestClient(app)
    r = bare.get("/admin/settings")
    assert r.status_code in (401, 403)
