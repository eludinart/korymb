"""Client Apify (API REST v2) — sans état, sans persistance en base.

La clé est lue dans l'environnement à chaque appel (APIFY_API_TOKEN), jamais en dur.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

APIFY_BASE_URL = "https://api.apify.com/v2"
_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class ApifyNotConfigured(RuntimeError):
    """Clé absente ou intégration désactivée."""


class ApifyError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def apify_enabled() -> bool:
    raw = (os.getenv("APIFY_ENABLED") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def apify_token() -> str:
    return (os.getenv("APIFY_API_TOKEN") or "").strip()


def apify_default_actor() -> str:
    return (os.getenv("APIFY_DEFAULT_ACTOR") or "").strip()


def apify_status() -> dict[str, Any]:
    return {
        "enabled": apify_enabled(),
        "configured": bool(apify_token()),
        "default_actor": apify_default_actor() or None,
    }


def _require_token() -> str:
    if not apify_enabled():
        raise ApifyNotConfigured("Intégration Apify désactivée (APIFY_ENABLED=0).")
    token = apify_token()
    if not token:
        raise ApifyNotConfigured("APIFY_API_TOKEN absent : ajoutez la clé dans les variables d'environnement (Coolify).")
    return token


def _actor_path(actor_id: str) -> str:
    # L'API accepte « user~actor » ; « user/actor » (format console) est converti.
    return actor_id.strip().replace("/", "~")


def _request(method: str, path: str, *, params: dict | None = None, json: Any = None, client: httpx.Client | None = None) -> Any:
    token = _require_token()
    headers = {"Authorization": f"Bearer {token}"}
    owns = client is None
    c = client or httpx.Client(base_url=APIFY_BASE_URL, timeout=_TIMEOUT)
    try:
        resp = c.request(method, f"{APIFY_BASE_URL}{path}", params=params, json=json, headers=headers)
    except httpx.TimeoutException as exc:
        raise ApifyError("Apify ne répond pas (délai dépassé).", 504) from exc
    except httpx.HTTPError as exc:
        raise ApifyError(f"Apify injoignable : {type(exc).__name__}", 502) from exc
    finally:
        if owns:
            c.close()
    if resp.status_code >= 400:
        detail = ""
        try:
            detail = ((resp.json() or {}).get("error") or {}).get("message") or ""
        except ValueError:
            detail = resp.text[:300]
        code = resp.status_code if resp.status_code in (400, 401, 403, 404) else 502
        raise ApifyError(f"Apify HTTP {resp.status_code} : {detail or 'erreur'}", code)
    try:
        return resp.json()
    except ValueError as exc:
        raise ApifyError("Réponse Apify illisible.", 502) from exc


def _summarize_run(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": run.get("id"),
        "actor_id": run.get("actId"),
        "status": run.get("status"),
        "started_at": run.get("startedAt"),
        "finished_at": run.get("finishedAt"),
        "dataset_id": run.get("defaultDatasetId"),
        "usage_usd": run.get("usageTotalUsd"),
    }


def start_run(actor_id: str, run_input: dict[str, Any] | None = None, *, client: httpx.Client | None = None) -> dict[str, Any]:
    actor = (actor_id or "").strip() or apify_default_actor()
    if not actor:
        raise ApifyError("actor_id requis (ou APIFY_DEFAULT_ACTOR).", 400)
    data = _request("POST", f"/acts/{_actor_path(actor)}/runs", json=run_input or {}, client=client)
    return _summarize_run((data or {}).get("data") or {})


def get_run(run_id: str, *, client: httpx.Client | None = None) -> dict[str, Any]:
    data = _request("GET", f"/actor-runs/{run_id}", client=client)
    return _summarize_run((data or {}).get("data") or {})


def list_runs(limit: int = 20, *, client: httpx.Client | None = None) -> list[dict[str, Any]]:
    data = _request("GET", "/actor-runs", params={"limit": limit, "desc": 1}, client=client)
    items = ((data or {}).get("data") or {}).get("items") or []
    return [_summarize_run(r) for r in items]


def get_results(run_id: str, limit: int = 100, *, client: httpx.Client | None = None) -> dict[str, Any]:
    run = get_run(run_id, client=client)
    if run.get("status") != "SUCCEEDED":
        return {"run": run, "items": [], "ready": False}
    dataset_id = run.get("dataset_id")
    if not dataset_id:
        return {"run": run, "items": [], "ready": True}
    items = _request(
        "GET", f"/datasets/{dataset_id}/items", params={"format": "json", "clean": 1, "limit": limit}, client=client
    )
    return {"run": run, "items": items if isinstance(items, list) else [], "ready": True}
