"""OAuth intégrations — démarrage (sans appels réseau fournisseur)."""
from __future__ import annotations

import pytest


def test_oauth_start_unknown_provider(client):
    r = client.post(
        "/admin/integrations/oauth/start",
        json={"provider": "nope", "redirect_uri": "http://localhost:3000/administration/integrations/oauth/callback"},
    )
    assert r.status_code == 400


def test_oauth_start_missing_client_id(client, monkeypatch):
    from services import integration_oauth as oauth

    monkeypatch.setattr(oauth, "provider_ready", lambda _p: False)

    def fake_getenv(name: str, default: str = "") -> str:
        return default

    monkeypatch.setattr("integration_settings.getenv", fake_getenv)
    r = client.post(
        "/admin/integrations/oauth/start",
        json={
            "provider": "google",
            "redirect_uri": "http://localhost:3000/administration/integrations/oauth/callback",
        },
    )
    assert r.status_code == 400
    assert "Client ID" in str(r.json().get("detail") or "")


def test_oauth_state_roundtrip(monkeypatch):
    from services.integration_oauth import read_oauth_state, sign_oauth_state

    monkeypatch.setattr("services.integration_oauth._jwt_secret", lambda: "test-secret-for-oauth-state")
    uri = "http://localhost:3000/administration/integrations/oauth/callback"
    state = sign_oauth_state(provider="linkedin", redirect_uri=uri)
    parsed = read_oauth_state(state)
    assert parsed["provider"] == "linkedin"
    assert parsed["redirect_uri"] == uri


def test_oauth_start_linkedin_encodes_scope_spaces(monkeypatch):
    from services import integration_oauth as oauth

    monkeypatch.setattr("services.integration_oauth._jwt_secret", lambda: "test-secret-for-oauth-state")

    def fake_getenv(name: str, default: str = "") -> str:
        values = {
            "LINKEDIN_CLIENT_ID": "7787lfzix4wni7",
            "LINKEDIN_CLIENT_SECRET": "secret",
        }
        return values.get(name, default)

    monkeypatch.setattr("integration_settings.getenv", fake_getenv)
    uri = "http://localhost:3000/administration/integrations/oauth/callback"
    started = oauth.start_oauth(provider="linkedin", redirect_uri=uri)
    url = started["authorize_url"]
    assert "scope=openid%20profile%20email%20w_member_social" in url
    assert "openid+profile" not in url
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fadministration%2Fintegrations%2Foauth%2Fcallback" in url
