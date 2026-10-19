"""Contrats admin Apify (httpx simulé, aucun appel réseau)."""
from __future__ import annotations

import httpx
import pytest

from services import apify_client



@pytest.fixture
def mocked(monkeypatch):
    calls: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        path = req.url.path
        if req.method == "POST" and path == "/v2/acts/apify~web-scraper/runs":
            return httpx.Response(201, json={"data": {"id": "run1", "actId": "a1", "status": "RUNNING", "defaultDatasetId": "ds1"}})
        if path == "/v2/actor-runs/run1":
            return httpx.Response(200, json={"data": {"id": "run1", "status": "SUCCEEDED", "defaultDatasetId": "ds1"}})
        if path == "/v2/actor-runs/run2":
            return httpx.Response(200, json={"data": {"id": "run2", "status": "RUNNING", "defaultDatasetId": "ds2"}})
        if path == "/v2/actor-runs":
            return httpx.Response(200, json={"data": {"items": [{"id": "run1", "status": "SUCCEEDED"}]}})
        if path == "/v2/datasets/ds1/items":
            return httpx.Response(200, json=[{"title": "Écolieu"}])
        return httpx.Response(404, json={"error": {"message": "not found"}})

    real = apify_client.httpx.Client
    monkeypatch.setattr(apify_client.httpx, "Client", lambda *a, **k: real(transport=httpx.MockTransport(handler)))
    monkeypatch.setenv("APIFY_API_TOKEN", "apify_test_token")
    monkeypatch.setenv("APIFY_ENABLED", "1")
    return calls


def test_missing_token_returns_503(client, monkeypatch):
    monkeypatch.delenv("APIFY_API_TOKEN", raising=False)
    r = client.get("/admin/apify/runs")
    assert r.status_code == 503
    assert "APIFY_API_TOKEN" in r.json()["detail"]


def test_disabled_returns_503(client, monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "x")
    monkeypatch.setenv("APIFY_ENABLED", "0")
    assert client.get("/admin/apify/runs").status_code == 503


def test_requires_admin(app, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("APIFY_API_TOKEN", "x")
    r = TestClient(app).get("/admin/apify/runs")
    assert r.status_code in (401, 403)


def test_start_run_and_results(client, mocked):
    r = client.post("/admin/apify/runs", json={"actor_id": "apify/web-scraper", "input": {"q": 1}})
    assert r.status_code == 200, r.text
    assert r.json()["run"]["id"] == "run1"
    assert mocked[0].headers["Authorization"] == "Bearer apify_test_token"
    assert mocked[0].content == b'{"q":1}' or b'"q"' in mocked[0].content

    assert client.get("/admin/apify/runs/run1").json()["run"]["status"] == "SUCCEEDED"
    res = client.get("/admin/apify/runs/run1/results?limit=10").json()
    assert res["ready"] is True and res["items"] == [{"title": "Écolieu"}]
    assert client.get("/admin/apify/runs").json()["items"][0]["id"] == "run1"


def test_results_not_ready(client, mocked):
    res = client.get("/admin/apify/runs/run2/results").json()
    assert res["ready"] is False and res["items"] == []


def test_upstream_404(client, mocked):
    assert client.get("/admin/apify/runs/unknown").status_code == 404


def test_invalid_run_id(client, mocked):
    assert client.get("/admin/apify/runs/bad%20id").status_code == 400
