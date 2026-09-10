"""Sonde santé unique — runtime settings + probes live."""
from __future__ import annotations


def test_tools_health_reads_runtime_wordpress_and_smtp(monkeypatch):
    import tools_health as th

    values = {
        "SMTP_HOST": "smtp.example.com",
        "SMTP_USER": "user@example.com",
        "SMTP_PASS": "secret",
        "WP_BASE_URL": "https://example.com",
        "WP_USER": "editor",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx",
    }
    monkeypatch.setattr(th, "_env", lambda name: values.get(name, ""))
    monkeypatch.setattr(th, "run_web_search", lambda q: "DuckDuckGo: ok")
    monkeypatch.setattr(th, "run_read_webpage", lambda u: "[Jina Reader]\nhello world page content here")
    monkeypatch.setattr(th, "_probe_facebook_graph", lambda: (False, ""))
    monkeypatch.setattr(th, "_probe_instagram_graph", lambda: (False, ""))
    monkeypatch.setattr(th, "_probe_smtp", lambda: (True, "reachable:465"))
    monkeypatch.setattr(th, "_probe_wordpress", lambda: (True, "Auth OK (editor)"))
    monkeypatch.setattr(th, "_probe_google_drive", lambda: (False, ""))
    monkeypatch.setattr(th, "_probe_crm", lambda: (False, False, ""))
    th._CACHE["t"] = 0.0
    th._CACHE["payload"] = None

    payload = th.probe_tools_health(force=True)
    assert payload["send_email"]["configured"] is True
    assert payload["send_email"]["ok"] is True
    assert payload["wordpress"]["configured"] is True
    assert payload["wordpress"]["ok"] is True
    assert payload["smtp"]["ok"] is True


def test_facebook_probe_rejects_non_numeric_page_id(monkeypatch):
    import tools_health as th

    monkeypatch.setattr(
        th,
        "_env",
        lambda name: {
            "FACEBOOK_ACCESS_TOKEN": "EAAB",
            "FACEBOOK_PAGE_ID": "AKKiVEKn97YaKvyWSr__WvU",
        }.get(name, ""),
    )
    ok, detail = th._probe_facebook_graph()
    assert ok is False
    assert "invalide" in detail.lower() or "chiffres" in detail.lower()


def test_facebook_probe_uses_graph_response(monkeypatch):
    import tools_health as th

    class _Resp:
        status_code = 400
        content = b"{}"

        def json(self):
            return {
                "error": {
                    "message": "Error validating access token: Session has expired",
                    "type": "OAuthException",
                    "code": 190,
                }
            }

    monkeypatch.setattr(
        th,
        "_env",
        lambda name: {
            "FACEBOOK_ACCESS_TOKEN": "EAAB",
            "FACEBOOK_PAGE_ID": "1234567890",
        }.get(name, ""),
    )
    monkeypatch.setattr("httpx.get", lambda *a, **k: _Resp())
    ok, detail = th._probe_facebook_graph()
    assert ok is False
    assert "expired" in detail.lower() or "Session" in detail


def test_system_health_uses_unified_probe(client, monkeypatch):
    import tools_health as th

    monkeypatch.setattr(
        th,
        "probe_tools_health",
        lambda force=False: {
            "send_email": {"configured": True, "ok": True, "note": "smtp"},
            "wordpress": {"configured": True, "ok": False, "probe_detail": "Auth refusée", "note": "wp"},
            "web_search": {"ok": True, "provider": "duckduckgo"},
            "facebook": {"configured": True, "ok": False, "probe_detail": "expired"},
        },
    )
    r = client.get("/admin/system-health")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["integrations"]["smtp"]["ok"] is True
    assert body["integrations"]["wordpress"]["ok"] is False
    assert "Auth" in (body["integrations"]["wordpress"].get("probe_detail") or "")
    assert body["integrations"]["facebook"]["ok"] is False
    assert body["tools_probe"]["web_search"]["ok"] is True


def test_crm_incomplete_not_ok(monkeypatch):
    import tools_health as th

    monkeypatch.setattr(th, "_env", lambda name: "notion" if name == "CRM_PROVIDER" else "")
    configured, ok, detail = th._probe_crm()
    assert configured is True
    assert ok is False
    assert "NOTION_API_KEY" in detail
