"""Contrat API configuration intégrations."""
from __future__ import annotations


def test_integration_settings_get(client):
    r = client.get("/admin/integration-settings")
    assert r.status_code == 200
    body = r.json()
    assert "catalog" in body
    assert "values" in body
    assert isinstance(body["catalog"], list)
    assert len(body["catalog"]) >= 5


def test_integration_settings_put_non_secret(client):
    r = client.put(
        "/admin/integration-settings",
        json={"fields": {"CRM_PROVIDER": "notion", "GOOGLE_CALENDAR_ID": "primary"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body["values"].get("CRM_PROVIDER") == "notion"
    assert body["values"].get("CRM_PROVIDER_set") is True
