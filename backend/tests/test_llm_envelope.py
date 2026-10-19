"""Enveloppe IA : clé serveur plafonnée, clé propre et espace Élude exemptés."""
from __future__ import annotations

import pytest

from services.llm_envelope import (
    EXHAUSTED_MESSAGE,
    LlmEnvelopeError,
    PAUSED_MESSAGE,
    assert_call_allowed,
    envelope_status,
)
from tenant_context import clear_tenant_context, set_tenant_context


def _register(client, email: str, workspace: str) -> tuple[str, str]:
    res = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "secretpass123",
            "display_name": "Test",
            "workspace_name": workspace,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    return body["token"], body["workspace"]["id"]


def test_platform_call_blocked_when_cap_reached(client):
    token, wid = _register(client, "env-cap@example.com", "Espace Cap")
    headers = {"Authorization": f"Bearer {token}"}
    patched = client.patch(
        f"/platform/llm-envelopes/{wid}",
        headers=headers,
        json={"monthly_token_cap": 0},
    )
    assert patched.status_code == 403

    from services.llm_envelope import update_envelope_policy

    update_envelope_policy(wid, monthly_token_cap=0)
    set_tenant_context(workspace_id=wid, user_id="u", role="admin")
    try:
        with pytest.raises(LlmEnvelopeError, match="enveloppe IA"):
            assert_call_allowed()
    finally:
        clear_tenant_context()

    status = envelope_status(wid)
    assert status["applies"] is True
    assert status["blocked"] is True
    assert EXHAUSTED_MESSAGE.startswith("L'enveloppe IA")


def test_own_key_skips_cap_and_pause_still_blocks(client, monkeypatch):
    token, wid = _register(client, "env-own@example.com", "Espace Cle")
    headers = {"Authorization": f"Bearer {token}"}
    set_tenant_context(workspace_id=wid, user_id="u", role="admin")
    try:
        from runtime_settings import save_partial

        save_partial({"anthropic_api_key": "sk-client-own"})
        from services.llm_envelope import update_envelope_policy

        update_envelope_policy(wid, monthly_token_cap=0)
        assert_call_allowed()
        update_envelope_policy(wid, paused=True)
        with pytest.raises(LlmEnvelopeError, match="en pause"):
            assert_call_allowed()
    finally:
        clear_tenant_context()
    assert PAUSED_MESSAGE.endswith("en pause.")
    me = client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json().get("is_platform_owner") is False


def test_legacy_workspace_is_exempt(client):
    set_tenant_context(workspace_id="ws-default-legacy", user_id="u", role="admin")
    try:
        assert assert_call_allowed() == "exempt"
    finally:
        clear_tenant_context()
    status = envelope_status("ws-default-legacy")
    assert status["exempt"] is True
    assert status["blocked"] is False


def test_usage_records_billing_source(client):
    _token, wid = _register(client, "env-log@example.com", "Espace Log")
    set_tenant_context(workspace_id=wid, user_id="u", role="admin")
    try:
        assert_call_allowed()
        from database import get_conn, log_llm_usage_event

        log_llm_usage_event(
            job_id=None,
            context_label="test",
            tier="lite",
            model="mistral-small",
            provider="mistral",
            tokens_in=40,
            tokens_out=10,
            cost_usd=0.001,
        )
        with get_conn() as conn:
            row = conn.execute(
                "SELECT billing_source, tokens_in, tokens_out FROM llm_usage_events WHERE workspace_id = ?",
                (wid,),
            ).fetchone()
        assert dict(row)["billing_source"] == "platform"
    finally:
        clear_tenant_context()
    status = envelope_status(wid)
    assert status["tokens_used_month"] == 50


def test_platform_owner_lists_and_updates(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "owner-env@example.com")
    owner_token, _owner_ws = _register(client, "owner-env@example.com", "Espace Owner")
    _client_token, client_ws = _register(client, "client-env@example.com", "Espace Client")
    denied = client.get(
        "/platform/llm-envelopes",
        headers={"Authorization": f"Bearer {_client_token}"},
    )
    assert denied.status_code == 403
    listed = client.get(
        "/platform/llm-envelopes",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert listed.status_code == 200, listed.text
    ids = [row["workspace_id"] for row in listed.json()["envelopes"]]
    assert client_ws in ids
    legacy = next(row for row in listed.json()["envelopes"] if row["workspace_id"] == "ws-default-legacy")
    assert legacy["exempt"] is True
    updated = client.patch(
        f"/platform/llm-envelopes/{client_ws}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"monthly_token_cap": 120000, "paused": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["monthly_token_cap"] == 120000
    refused = client.patch(
        "/platform/llm-envelopes/ws-default-legacy",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"paused": True},
    )
    assert refused.status_code == 400


def test_llm_turn_does_not_call_provider_when_blocked(client, monkeypatch):
    _token, wid = _register(client, "env-block@example.com", "Espace Block")
    from services.llm_envelope import update_envelope_policy

    update_envelope_policy(wid, monthly_token_cap=0)
    set_tenant_context(workspace_id=wid, user_id="u", role="admin")

    def _boom(*_a, **_k):
        raise AssertionError("le fournisseur ne doit pas être appelé")

    monkeypatch.setattr("anthropic.Anthropic", _boom)
    try:
        from llm_client import llm_turn

        with pytest.raises(LlmEnvelopeError):
            llm_turn("système", "bonjour", max_tokens=16)
    finally:
        clear_tenant_context()
