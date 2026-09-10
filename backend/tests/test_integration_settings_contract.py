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
    linkedin = next(g for g in body["catalog"] if g["id"] == "linkedin_publish")
    assert linkedin.get("setup_url", "").startswith("https://www.linkedin.com/developers")
    assert linkedin.get("oauth") == "linkedin"
    tavily = next(
        f for g in body["catalog"] if g["id"] == "web_search" for f in g["fields"] if f["key"] == "TAVILY_API_KEY"
    )
    assert tavily.get("setup_url", "").startswith("https://")
    media = next(g for g in body["catalog"] if g["id"] == "media_ai")
    keys = {f["key"] for f in media["fields"]}
    assert "MEDIA_ENGINE_MODE" in keys
    assert "IMAGE_ENGINE_CHAIN" in keys
    assert media.get("section") == "creative"
    chain = next(f for f in media["fields"] if f["key"] == "IMAGE_ENGINE_CHAIN")
    assert chain.get("advanced") is True
    mode = next(f for f in media["fields"] if f["key"] == "MEDIA_ENGINE_MODE")
    assert mode.get("advanced") is False
    google = next(g for g in body["catalog"] if g["id"] == "google_oauth")
    assert google.get("section") == "essentials"
    client_id = next(f for f in google["fields"] if f["key"] == "GOOGLE_OAUTH_CLIENT_ID")
    assert client_id.get("advanced") is False
    refresh = next(f for f in google["fields"] if f["key"] == "GOOGLE_OAUTH_REFRESH_TOKEN")
    assert refresh.get("advanced") is True


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
