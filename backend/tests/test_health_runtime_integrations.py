"""Sondes santé : respecter les surcharges UI (DB), pas seulement os.environ."""
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
    th._CACHE["t"] = 0.0
    th._CACHE["payload"] = None

    payload = th.probe_tools_health(force=True)
    assert payload["send_email"]["configured"] is True
    assert payload["send_email"]["ok"] is True
    assert payload["wordpress"]["configured"] is True
    assert payload["wordpress"]["ok"] is True


def test_system_health_smtp_uses_runtime_host(client, monkeypatch):
    import routers.core_health as ch
    import tools_health as th

    monkeypatch.setattr(ch, "_env_is_set", lambda name: name in {"SMTP_HOST", "SMTP_USER", "SMTP_PASS", "WP_BASE_URL", "WP_USER", "WP_APP_PASSWORD"})
    monkeypatch.setattr(
        "integration_settings.getenv",
        lambda name, default="": {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_USER": "u",
            "SMTP_PASS": "p",
            "WP_BASE_URL": "https://example.com",
            "WP_USER": "u",
            "WP_APP_PASSWORD": "p",
        }.get(name, default),
    )
    monkeypatch.setattr(ch, "_probe_tcp", lambda host, port, timeout_s=2.5: (True, "reachable"))
    monkeypatch.setattr(
        th,
        "probe_tools_health",
        lambda force=False: {
            "wordpress": {"ok": True, "configured": True},
            "web_search": {"ok": True, "provider": "duckduckgo"},
        },
    )

    r = client.get("/admin/system-health")
    assert r.status_code == 200, r.text
    body = r.json()
    smtp = body["integrations"]["smtp"]
    assert smtp["configured"] is True
    assert smtp["ok"] is True
    wp = body["integrations"]["wordpress"]
    assert wp["configured"] is True
    assert wp["ok"] is True
