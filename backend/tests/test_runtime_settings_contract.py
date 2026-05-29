"""Contrats API : merge runtime settings (ADR 0001)."""
from __future__ import annotations


def test_admin_settings_get(client):
    r = client.get("/admin/settings")
    assert r.status_code == 200
    body = r.json()
    assert "llm_provider" in body
    assert body["llm_provider"] in ("anthropic", "openrouter")
    assert "anthropic_api_key_set" in body or "anthropic_api_key" in body


def test_admin_settings_put_persists(client):
    r = client.put("/admin/settings", json={"openrouter_app_title": "Korymb Test Suite"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("openrouter_app_title") == "Korymb Test Suite"

    r2 = client.get("/admin/settings")
    assert r2.status_code == 200
    assert r2.json().get("openrouter_app_title") == "Korymb Test Suite"


def test_admin_settings_rejects_invalid_provider(client):
    r = client.put("/admin/settings", json={"llm_provider": "invalid"})
    assert r.status_code == 400
