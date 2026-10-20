"""Un refresh Google refusé ne doit pas être rejoué à chaque contact."""
from __future__ import annotations

import httpx


def test_invalid_grant_is_cached(monkeypatch):
    import tools

    tools._GOOGLE_TOKEN_CACHE["access_token"] = ""
    tools._GOOGLE_TOKEN_CACHE["expires_at"] = 0.0
    tools._GOOGLE_TOKEN_CACHE["refresh_failed_until"] = 0.0
    monkeypatch.setattr(
        tools,
        "getenv",
        lambda name, default="": {
            "GOOGLE_OAUTH_REFRESH_TOKEN": "refresh",
            "GOOGLE_OAUTH_CLIENT_ID": "client",
            "GOOGLE_OAUTH_CLIENT_SECRET": "secret",
        }.get(name, default),
    )
    calls: list[int] = []
    request = httpx.Request("POST", "https://oauth2.googleapis.com/token")
    response = httpx.Response(400, json={"error": "invalid_grant"}, request=request)

    def _post(*args, **kwargs):
        calls.append(1)
        return response

    monkeypatch.setattr(tools.httpx, "post", _post)
    assert tools._refresh_google_access_token() == ""
    assert tools._refresh_google_access_token(force=True) == ""
    assert len(calls) == 1
