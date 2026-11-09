"""Reset mot de passe : self-service e-mail + force admin / owner plateforme."""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import services.workspace_auth as auth


def _register(client, email: str, workspace: str) -> tuple[str, str, str]:
    res = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "secretpass123",
            "display_name": email.split("@")[0],
            "workspace_name": workspace,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    return body["token"], body["workspace"]["id"], body["workspace"]["slug"]


def _auth(token: str, workspace_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    return headers


def _capture_reset_url(monkeypatch):
    captured: dict[str, str] = {}

    def fake_send(*, to: str, name: str, reset_url: str):
        captured["to"] = to
        captured["url"] = reset_url
        return True, "ok"

    monkeypatch.setattr(auth, "_send_password_reset_email", fake_send)
    return captured


def _token_from_url(url: str) -> str:
    qs = parse_qs(urlparse(url).query)
    return (qs.get("token") or [""])[0]


def test_self_service_password_reset_flow(client, monkeypatch):
    captured = _capture_reset_url(monkeypatch)
    _register(client, "reset-self@example.com", "Reset Self WS")

    req = client.post(
        "/auth/password-reset/request",
        json={"email": "reset-self@example.com", "audience": "operator"},
    )
    assert req.status_code == 200, req.text
    assert req.json()["ok"] is True
    assert "message" in req.json()
    assert captured.get("url")
    token = _token_from_url(captured["url"])
    assert len(token) >= 16

    bad = client.post(
        "/auth/password-reset/confirm",
        json={"token": token, "new_password": "short"},
    )
    assert bad.status_code == 422

    ok = client.post(
        "/auth/password-reset/confirm",
        json={"token": token, "new_password": "nouveaumdp99"},
    )
    assert ok.status_code == 200, ok.text

    reuse = client.post(
        "/auth/password-reset/confirm",
        json={"token": token, "new_password": "autresmdp99"},
    )
    assert reuse.status_code == 400

    login_old = client.post(
        "/auth/login",
        json={"email": "reset-self@example.com", "password": "secretpass123"},
    )
    assert login_old.status_code == 401
    login_new = client.post(
        "/auth/login",
        json={"email": "reset-self@example.com", "password": "nouveaumdp99"},
    )
    assert login_new.status_code == 200, login_new.text


def test_password_reset_unknown_email_is_generic(client, monkeypatch):
    captured = _capture_reset_url(monkeypatch)
    res = client.post(
        "/auth/password-reset/request",
        json={"email": "ghost-nobody@example.com", "audience": "operator"},
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert not captured.get("url")


def test_workspace_admin_can_force_member_password(client):
    admin_token, ws_id, _slug = _register(client, "adm-force@example.com", "Force WS")
    headers = _auth(admin_token, ws_id)
    from workspace_db import add_member, create_user, get_user_by_email
    from services.workspace_auth import hash_password

    create_user("member-force@example.com", hash_password("ancienmdp12"), "Member Force")
    user = get_user_by_email("member-force@example.com")
    assert user
    add_member(ws_id, "member-force@example.com", "member")

    set_pwd = client.post(
        f"/auth/users/{user['id']}/password",
        headers=headers,
        json={"new_password": "forceadmin88"},
    )
    assert set_pwd.status_code == 200, set_pwd.text
    login = client.post(
        "/auth/login",
        json={"email": "member-force@example.com", "password": "forceadmin88", "audience": "operator"},
    )
    assert login.status_code == 200, login.text


def test_workspace_admin_cannot_reset_other_workspace_user(client):
    token_a, ws_a, _ = _register(client, "adm-a@example.com", "Space A")
    token_b, _ws_b, _ = _register(client, "adm-b@example.com", "Space B")
    from workspace_db import get_user_by_email

    user_b = get_user_by_email("adm-b@example.com")
    assert user_b
    denied = client.post(
        f"/auth/users/{user_b['id']}/password",
        headers=_auth(token_a, ws_a),
        json={"new_password": "hackerpass99"},
    )
    assert denied.status_code == 403
    assert token_b  # keep register side-effect


def test_platform_owner_can_search_and_reset_any_user(client, monkeypatch):
    monkeypatch.setenv("KORYMB_PLATFORM_OWNER_EMAIL", "owner-reset@example.com")
    owner_token, owner_ws, _ = _register(client, "owner-reset@example.com", "QG Owner Reset")
    _client_token, _client_ws, _ = _register(client, "client-mer@example.com", "Mer et Decouverte 83")
    from workspace_db import get_user_by_email

    client_user = get_user_by_email("client-mer@example.com")
    assert client_user

    search = client.get(
        "/auth/users/search?q=mer%20et%20decouverte",
        headers=_auth(owner_token, owner_ws),
    )
    assert search.status_code == 200, search.text
    emails = {u.get("email") for u in search.json().get("users") or []}
    assert "client-mer@example.com" in emails

    forced = client.post(
        f"/auth/users/{client_user['id']}/password",
        headers=_auth(owner_token, owner_ws),
        json={"new_password": "merdecouverte83"},
    )
    assert forced.status_code == 200, forced.text
    login = client.post(
        "/auth/login",
        json={"email": "client-mer@example.com", "password": "merdecouverte83"},
    )
    assert login.status_code == 200, login.text


def test_admin_send_reset_link(client, monkeypatch):
    captured = _capture_reset_url(monkeypatch)
    admin_token, ws_id, _ = _register(client, "adm-link@example.com", "Link WS")
    from workspace_db import create_user, add_member, get_user_by_email
    from services.workspace_auth import hash_password

    create_user("link-target@example.com", hash_password("ancienmdp12"), "Link Target")
    user = get_user_by_email("link-target@example.com")
    assert user
    add_member(ws_id, "link-target@example.com", "member")

    sent = client.post(
        f"/auth/users/{user['id']}/password-reset",
        headers=_auth(admin_token, ws_id),
    )
    assert sent.status_code == 200, sent.text
    assert sent.json().get("mail_sent") is True
    token = _token_from_url(captured["url"])
    confirm = client.post(
        "/auth/password-reset/confirm",
        json={"token": token, "new_password": "lienreset99"},
    )
    assert confirm.status_code == 200, confirm.text


def test_subscriber_reset_requires_workspace_slug(client, monkeypatch):
    captured = _capture_reset_url(monkeypatch)
    _token, _ws, slug = _register(client, "ops-sub-reset@example.com", "Sub Reset Shop")
    # publish + subscriber
    login = client.post(
        "/auth/login",
        json={"email": "ops-sub-reset@example.com", "password": "secretpass123"},
    )
    headers = _auth(login.json()["token"])
    client.patch("/storefront/settings", headers=headers, json={"public_enabled": True})
    sub = client.post(
        "/auth/register-subscriber",
        json={
            "email": "part-reset@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    assert sub.status_code == 200, sub.text

    no_slug = client.post(
        "/auth/password-reset/request",
        json={"email": "part-reset@example.com", "audience": "subscriber"},
    )
    assert no_slug.status_code == 200
    assert not captured.get("url")

    with_slug = client.post(
        "/auth/password-reset/request",
        json={
            "email": "part-reset@example.com",
            "audience": "subscriber",
            "workspace_slug": slug,
        },
    )
    assert with_slug.status_code == 200
    assert captured.get("url")
