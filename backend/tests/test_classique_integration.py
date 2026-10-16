"""Intégration Classique : routage, API partagée, webhook HMAC, pont agenda."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import pytest

from services.classique_router import route

KEY = "clq-test-key"


@pytest.mark.parametrize(
    "category,target",
    [("business", "korymb"), ("metier", "korymb"), ("personal", "classique"), ("technique", "classique"),
     ("mixte", "concertation"), ("undetermined", "eric"), ("d", "eric")],
)
def test_router_explicit_category(category, target):
    out = route(category=category, intent="peu importe")
    assert out["target"] == target and out["source"] == "explicit"


def test_router_keywords():
    assert route(intent="Relancer le devis du client Dupont")["target"] == "korymb"
    assert route(intent="Corriger le déploiement Docker sur le VPS")["target"] == "classique"
    assert route(intent="Mettre la vitrine des ateliers en ligne", payload={"note": "bug DNS"})["target"] == "concertation"
    out = route(intent="Fais le nécessaire")
    assert out["target"] == "eric" and out["category"] == "undetermined"


def test_router_invalid_category_falls_back_to_keywords():
    assert route(category="nimporte", intent="facture client")["target"] == "korymb"


@pytest.fixture
def clq(client, monkeypatch):
    monkeypatch.setenv("CLASSIQUE_API_KEY_SHA256", hashlib.sha256(KEY.encode()).hexdigest())
    monkeypatch.setenv("CLASSIQUE_WEBHOOK_SECRET", "whsec")
    return {"Authorization": f"Bearer {KEY}"}


def test_api_requires_key(client, monkeypatch):
    monkeypatch.delenv("CLASSIQUE_API_KEY", raising=False)
    monkeypatch.delenv("CLASSIQUE_API_KEY_SHA256", raising=False)
    assert client.post("/classique/tasks", json={"intent": "x"}).status_code == 503
    monkeypatch.setenv("CLASSIQUE_API_KEY", KEY)
    r = client.post("/classique/tasks", json={"intent": "x"}, headers={"Authorization": "Bearer faux"})
    assert r.status_code == 401


def test_task_lifecycle_and_signed_callback(client, clq, monkeypatch):
    r = client.post("/classique/tasks", headers=clq, json={
        "intent": "Mettre à jour le script de backup", "payload": {"repo": "korymb"},
        "callback_url": "https://classique.example/hook", "external_id": "ext-1",
    })
    assert r.status_code == 202
    env = r.json()
    assert env["target"] == "classique" and env["status"] == "routed_to_classique"
    assert env["workspace"] == "ws-default-legacy" and env["poll_url"].endswith(env["id"])

    sent = {}

    def fake_post(url, content, headers, timeout):
        sent.update(url=url, body=content, headers=headers)
        return type("R", (), {"status_code": 200})()

    monkeypatch.setattr("httpx.post", fake_post)
    r = client.post(f"/classique/tasks/{env['id']}/result", headers=clq,
                    json={"status": "completed", "result": {"ok": True}})
    assert r.status_code == 200 and r.json()["status"] == "completed"
    ts = sent["headers"]["X-Korymb-Timestamp"]
    expected = "sha256=" + hmac.new(b"whsec", f"{ts}.".encode() + sent["body"], hashlib.sha256).hexdigest()
    assert sent["headers"]["X-Korymb-Signature"] == expected

    polled = client.get(f"/classique/tasks/{env['id']}", headers=clq).json()
    assert polled["result"] == {"ok": True}
    # Terminal : plus de modification
    again = client.post(f"/classique/tasks/{env['id']}/result", headers=clq, json={"status": "failed"})
    assert again.status_code == 409


def test_business_task_not_completable_by_classique(client, clq):
    env = client.post("/classique/tasks", headers=clq, json={"intent": "x", "category": "business"}).json()
    assert env["status"] == "queued" and env["target"] == "korymb"
    r = client.post(f"/classique/tasks/{env['id']}/result", headers=clq, json={"status": "completed"})
    assert r.status_code == 409
    # L'opérateur Korymb peut clôturer
    done = client.post(f"/classique/admin/tasks/{env['id']}", json={"status": "completed", "result": "fait"})
    assert done.status_code == 200
    listed = client.get("/classique/admin/tasks").json()["tasks"]
    assert any(t["id"] == env["id"] for t in listed)


def test_identity_endpoint(client, clq):
    data = client.get("/classique/identity").json()
    assert data["id"] == "classique" and data["configured"] is True
    assert data["calendar_sync"]["enabled"] is False


def test_calendar_sync_disabled_by_default(client, monkeypatch):
    monkeypatch.delenv("KORYMB_GCAL_SYNC_ENABLED", raising=False)
    assert client.post("/calendar-sync/run").status_code == 409
    assert client.get("/calendar-sync/status").json()["enabled"] is False


class FakeGCal:
    def __init__(self, events):
        self.events = events
        self.inserted = []
        self.patched = []

    def list_events(self, a, b):
        return self.events

    def insert_event(self, body):
        self.inserted.append(body)
        return {"id": f"g-new-{len(self.inserted)}", "updated": "now"}

    def patch_event(self, gid, body):
        self.patched.append((gid, body))
        return {}


def _iso(d):
    return d.isoformat()


def test_calendar_sync_pull_push_conflict(client):
    from services import business_db as biz
    from services import calendar_sync as cs

    base = (datetime.now(timezone.utc) + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
    g_busy = {"id": "g-busy", "summary": "Rdv perso", "updated": "u1",
              "start": {"dateTime": _iso(base)}, "end": {"dateTime": _iso(base + timedelta(hours=1))}}
    clash = biz.create_calendar_event(title="Séance client", starts_at=_iso(base + timedelta(minutes=30)),
                                      ends_at=_iso(base + timedelta(hours=2)))
    free = biz.create_calendar_event(title="Atelier", starts_at=_iso(base + timedelta(days=1)),
                                     ends_at=_iso(base + timedelta(days=1, hours=1)))
    fake = FakeGCal([g_busy])
    summary = cs.run_sync(trigger="test", client=fake, workspace_id="ws-default-legacy")
    assert summary["imported"] == 1
    # D'autres tests peuvent avoir laissé des créneaux futurs : on cible les nôtres.
    pushed_ids = [b["extendedProperties"]["private"]["korymb_event_id"] for b in fake.inserted]
    assert free["id"] in pushed_ids and clash["id"] not in pushed_ids
    conflicts = cs.list_conflicts("ws-default-legacy")
    assert any(c["kind"] == "slot_already_booked" and c["event_id"] == clash["id"] for c in conflicts)
    assert not biz.get_calendar_event(clash["id"])["google_event_id"]

    # Google déplace le rdv importé : Korymb suit l'heure Google.
    moved = dict(g_busy, start={"dateTime": _iso(base + timedelta(hours=4))},
                 end={"dateTime": _iso(base + timedelta(hours=5))}, updated="u2")
    s2 = cs.run_sync(trigger="test", client=FakeGCal([moved]), workspace_id="ws-default-legacy")
    assert s2["times_updated"] >= 1
    imported = [e for e in biz.list_calendar_events(limit=500) if e.get("google_event_id") == "g-busy"][0]
    assert imported["starts_at"].startswith((base + timedelta(hours=4)).strftime("%Y-%m-%dT%H"))

    # Annulation Google -> annulé dans Korymb.
    s3 = cs.run_sync(trigger="test", client=FakeGCal([dict(moved, status="cancelled")]), workspace_id="ws-default-legacy")
    assert s3["cancelled"] == 1

    cid = conflicts[0]["id"]
    assert client.post(f"/calendar-sync/conflicts/{cid}/resolve", json={"resolution": "dismissed"}).status_code == 200
