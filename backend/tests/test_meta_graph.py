"""Erreurs Graph Meta — messages actionnables, pas le 400 httpx brut."""
from __future__ import annotations

import httpx


def test_graph_failure_expired_token():
    from tools import _graph_failure

    resp = httpx.Response(
        400,
        json={"error": {"message": "Error validating access token: Session has expired", "code": 190}},
    )
    msg = _graph_failure(resp)
    assert "expiré" in msg.lower()
    assert "400 Bad Request" not in msg
    assert "graph.facebook.com" not in msg


def test_post_facebook_rejects_non_numeric_page_id(monkeypatch):
    import tools

    monkeypatch.setattr(tools, "getenv", lambda key, default="": {
        "FACEBOOK_ACCESS_TOKEN": "EAA-test",
        "FACEBOOK_PAGE_ID": "not-a-numeric-id",
    }.get(key, default))
    out = tools.run_post_facebook("Hello")
    assert out.startswith("Erreur Facebook")
    assert "chiffres" in out.lower()
    assert "graph.facebook.com" not in out
