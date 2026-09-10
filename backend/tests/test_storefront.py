"""Vitrine publique et comptes participants (subscribers)."""
from __future__ import annotations


def _activate(client, admin_headers: dict, register_res) -> None:
    uid = (register_res.json().get("user") or {}).get("id")
    r = client.post(f"/storefront/participants/{uid}/validate", headers=admin_headers)
    assert r.status_code == 200, r.text


def test_legacy_storefront_is_public(client):
    r = client.get("/public/storefront/eludein")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("slug") == "eludein"
    assert body.get("public_enabled") is True
    assert "events" in body
    assert isinstance(body.get("offers"), list)


def test_subscriber_cannot_access_cockpit(client):
    slug = "eludein"
    sub = client.post(
        "/auth/register-subscriber",
        json={
            "email": "participant@example.com",
            "password": "secretpass123",
            "display_name": "Participant",
            "workspace_slug": slug,
        },
    )
    assert sub.status_code == 200, sub.text
    token = sub.json()["token"]
    assert sub.json().get("role") == "subscriber"
    headers = {"Authorization": f"Bearer {token}", "X-Agent-Secret": ""}

    jobs = client.get("/jobs/light", headers=headers)
    assert jobs.status_code == 403, jobs.text

    home = client.get("/subscriber/home", headers={"Authorization": f"Bearer {token}"})
    assert home.status_code == 200, home.text
    assert home.json().get("slug") == slug


def test_operator_publishes_event_on_storefront(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-vitrine@example.com",
            "password": "secretpass123",
            "display_name": "Dirigeant",
            "workspace_name": "Atelier Test",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    slug = reg.json()["workspace"]["slug"]
    auth = {"Authorization": f"Bearer {token}"}

    patch = client.patch(
        "/storefront/settings",
        headers=auth,
        json={
            "public_enabled": True,
            "tagline": "Ateliers ouverts",
            "intro": "Parcours hybride.",
            "offers": [{"title": "Stage", "summary": "Présentiel + visio."}],
        },
    )
    assert patch.status_code == 200, patch.text

    from datetime import datetime, timedelta

    starts = (datetime.utcnow() + timedelta(days=10)).isoformat()
    ev = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Atelier ouvert",
            "starts_at": starts,
            "event_type": "atelier",
            "is_public": True,
            "modality": "presentiel",
            "location": "Tourves",
        },
    )
    assert ev.status_code == 200, ev.text
    assert ev.json().get("is_public") is True

    public = client.get(f"/public/storefront/{slug}")
    assert public.status_code == 200, public.text
    titles = [e.get("title") for e in public.json().get("events") or []]
    assert "Atelier ouvert" in titles


def test_disabled_storefront_is_not_public(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "hidden-vitrine@example.com",
            "password": "secretpass123",
            "workspace_name": "Caché",
        },
    )
    slug = reg.json()["workspace"]["slug"]
    r = client.get(f"/public/storefront/{slug}")
    assert r.status_code == 404


def test_published_resource_unlocks_for_subscriber(client):
    from datetime import datetime, timedelta

    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-ressource@example.com",
            "password": "secretpass123",
            "workspace_name": "Parcours Hybride",
        },
    )
    token = reg.json()["token"]
    slug = reg.json()["workspace"]["slug"]
    auth = {"Authorization": f"Bearer {token}"}
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True, "tagline": "Hybride"})

    opened = (datetime.utcnow() - timedelta(hours=2)).isoformat()
    future = (datetime.utcnow() + timedelta(days=5)).isoformat()
    res_open = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Module 1 — vidéo",
            "starts_at": opened,
            "event_type": "ressource",
            "nature": "matiere",
            "modality": "async",
            "is_public": True,
            "resource_type": "video",
            "resource_url": "https://example.com/module-1",
        },
    )
    assert res_open.status_code == 200, res_open.text
    assert res_open.json().get("nature") == "matiere"
    assert res_open.json().get("resource_url") == "https://example.com/module-1"

    client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Module 2 — à venir",
            "starts_at": future,
            "event_type": "ressource",
            "nature": "matiere",
            "is_public": True,
            "resource_type": "podcast",
            "resource_url": "https://example.com/secret-module-2",
        },
    )

    public = client.get(f"/public/storefront/{slug}").json()
    upcoming_titles = [r.get("title") for r in public.get("resources_upcoming") or []]
    assert "Module 2 — à venir" in upcoming_titles
    for item in public.get("resources_upcoming") or []:
        assert "resource_url" not in item
    assert "Module 1 — vidéo" not in [e.get("title") for e in public.get("events") or []]

    sub = client.post(
        "/auth/register-subscriber",
        json={
            "email": "eleve-parcours@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    _activate(client, auth, sub)
    home = client.get("/subscriber/home", headers={"Authorization": f"Bearer {sub.json()['token']}"}).json()
    unlocked = home.get("resources") or []
    assert any(r.get("title") == "Module 1 — vidéo" and r.get("resource_url") == "https://example.com/module-1" for r in unlocked)
    assert any(r.get("title") == "Module 2 — à venir" for r in home.get("resources_upcoming") or [])
    for item in home.get("resources_upcoming") or []:
        assert "resource_url" not in item


def test_public_visibility_exposes_resource_without_account(client):
    from datetime import datetime, timedelta

    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-public@example.com",
            "password": "secretpass123",
            "workspace_name": "Public Docs",
        },
    )
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    slug = reg.json()["workspace"]["slug"]
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})
    opened = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    ev = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Guide ouvert",
            "starts_at": opened,
            "event_type": "ressource",
            "nature": "matiere",
            "visibility": "public",
            "resource_type": "document",
            "resource_url": "https://example.com/guide",
        },
    )
    assert ev.status_code == 200, ev.text
    assert ev.json().get("visibility") == "public"
    public = client.get(f"/public/storefront/{slug}").json()
    titles = [r.get("title") for r in public.get("resources") or []]
    assert "Guide ouvert" in titles
    match = next(r for r in public["resources"] if r["title"] == "Guide ouvert")
    assert match.get("resource_url") == "https://example.com/guide"


def test_selected_visibility_is_nominative(client):
    from datetime import datetime, timedelta

    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-nomine@example.com",
            "password": "secretpass123",
            "workspace_name": "Nominatif",
        },
    )
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    slug = reg.json()["workspace"]["slug"]
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})
    alice = client.post(
        "/business/contacts",
        headers=auth,
        json={"name": "Alice", "email": "alice-nomine@example.com"},
    )
    bob = client.post(
        "/business/contacts",
        headers=auth,
        json={"name": "Bob", "email": "bob-nomine@example.com"},
    )
    assert alice.status_code == 200, alice.text
    opened = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    ev = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Dossier Alice",
            "starts_at": opened,
            "event_type": "ressource",
            "nature": "matiere",
            "visibility": "selected",
            "audience_contact_ids": [alice.json()["id"]],
            "resource_type": "document",
            "resource_url": "https://example.com/alice-only",
        },
    )
    assert ev.status_code == 200, ev.text
    assert alice.json()["id"] in (ev.json().get("audience_contact_ids") or [])
    public = client.get(f"/public/storefront/{slug}").json()
    assert "Dossier Alice" not in [r.get("title") for r in public.get("resources") or []]
    assert "Dossier Alice" not in [r.get("title") for r in public.get("resources_upcoming") or []]

    sub_alice = client.post(
        "/auth/register-subscriber",
        json={
            "email": "alice-nomine@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    sub_bob = client.post(
        "/auth/register-subscriber",
        json={
            "email": "bob-nomine@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    _activate(client, auth, sub_alice)
    _activate(client, auth, sub_bob)
    home_a = client.get(
        "/subscriber/home",
        headers={"Authorization": f"Bearer {sub_alice.json()['token']}"},
    ).json()
    home_b = client.get(
        "/subscriber/home",
        headers={"Authorization": f"Bearer {sub_bob.json()['token']}"},
    ).json()
    assert any(r.get("title") == "Dossier Alice" for r in home_a.get("resources") or [])
    assert not any(r.get("title") == "Dossier Alice" for r in home_b.get("resources") or [])
    _ = bob


def test_storefront_identity_and_brand_image(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc``\x00\x00"
        b"\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-peau@example.com",
            "password": "secretpass123",
            "workspace_name": "Atelier Peau",
        },
    )
    token = reg.json()["token"]
    slug = reg.json()["workspace"]["slug"]
    auth = {"Authorization": f"Bearer {token}"}
    uploaded = client.post(
        "/storefront/brand-files?kind=logo",
        headers=auth,
        files={"file": ("logo.png", png, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    patch = client.patch(
        "/storefront/settings",
        headers=auth,
        json={
            "public_enabled": True,
            "location": "Tourves",
            "accent": "terracotta",
            "paper": "warm",
            "typeface": "serif",
            "contact_email": "hello@example.com",
        },
    )
    assert patch.status_code == 200, patch.text
    assert patch.json().get("accent") == "terracotta"
    assert patch.json().get("location") == "Tourves"
    public = client.get(f"/public/storefront/{slug}").json()
    assert public.get("accent") == "terracotta"
    assert public.get("has_logo") is True
    assert "logo_file_id" not in public
    logo = client.get(f"/public/storefront/{slug}/brand/logo?inline=true")
    assert logo.status_code == 200, logo.text
    assert logo.headers.get("content-type", "").startswith("image/")


def test_event_cover_image_on_storefront(client, tmp_path, monkeypatch):
    from datetime import datetime, timedelta

    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc``\x00\x00"
        b"\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-cover-evt@example.com",
            "password": "secretpass123",
            "workspace_name": "Atelier Cover",
        },
    )
    token = reg.json()["token"]
    slug = reg.json()["workspace"]["slug"]
    auth = {"Authorization": f"Bearer {token}"}
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})
    uploaded = client.post(
        "/business/resource-files",
        headers=auth,
        files={"file": ("seance.png", png, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    cover_id = uploaded.json()["file"]["id"]
    starts = (datetime.utcnow() + timedelta(days=2)).isoformat()
    ev = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Séance illustrée",
            "starts_at": starts,
            "visibility": "public",
            "cover_file_id": cover_id,
        },
    )
    assert ev.status_code == 200, ev.text
    event_id = ev.json()["id"]
    assert ev.json().get("has_cover") is True
    public = client.get(f"/public/storefront/{slug}").json()
    found = next(e for e in (public.get("events") or []) if e["id"] == event_id)
    assert found.get("has_cover") is True
    cover = client.get(f"/public/storefront/{slug}/events/{event_id}/cover?inline=true")
    assert cover.status_code == 200, cover.text
    assert cover.headers.get("content-type", "").startswith("image/")

    # Teaser « inscrits » : cover publique autorisée même si le fichier ressource reste privé
    ev2 = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Module inscrits",
            "starts_at": (datetime.utcnow() + timedelta(days=5)).isoformat(),
            "visibility": "participants",
            "resource_type": "document",
            "cover_file_id": cover_id,
        },
    )
    assert ev2.status_code == 200, ev2.text
    eid2 = ev2.json()["id"]
    cover2 = client.get(f"/public/storefront/{slug}/events/{eid2}/cover?inline=true")
    assert cover2.status_code == 200, cover2.text


def test_public_upcoming_teasers_are_capped(client):
    from datetime import datetime, timedelta

    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-teasers@example.com",
            "password": "secretpass123",
            "workspace_name": "Teasers",
        },
    )
    token = reg.json()["token"]
    slug = reg.json()["workspace"]["slug"]
    auth = {"Authorization": f"Bearer {token}"}
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})
    future = datetime.utcnow() + timedelta(days=2)
    for i in range(5):
        client.post(
            "/business/events",
            headers=auth,
            json={
                "title": f"Module teaser {i}",
                "starts_at": (future + timedelta(days=i)).isoformat(),
                "event_type": "ressource",
                "is_public": True,
                "resource_type": "document",
                "resource_url": "https://example.com/x",
            },
        )
    public = client.get(f"/public/storefront/{slug}").json()
    assert len(public.get("resources_upcoming") or []) <= 3


def test_pending_subscriber_cannot_see_inscrits_resources(client):
    from datetime import datetime, timedelta

    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-pending@example.com",
            "password": "secretpass123",
            "workspace_name": "Pending Gate",
        },
    )
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    slug = reg.json()["workspace"]["slug"]
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})
    opened = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Réservé inscrits",
            "starts_at": opened,
            "event_type": "ressource",
            "visibility": "participants",
            "resource_type": "document",
            "resource_url": "https://example.com/inscrits",
        },
    )
    client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Guide public",
            "starts_at": opened,
            "event_type": "ressource",
            "visibility": "public",
            "resource_type": "document",
            "resource_url": "https://example.com/public",
        },
    )
    sub = client.post(
        "/auth/register-subscriber",
        json={
            "email": "en-attente@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    assert sub.status_code == 200, sub.text
    assert sub.json().get("membership_status") == "pending"
    headers = {"Authorization": f"Bearer {sub.json()['token']}"}
    home = client.get("/subscriber/home", headers=headers).json()
    titles = [r.get("title") for r in home.get("resources") or []]
    assert "Réservé inscrits" not in titles
    assert "Guide public" in titles
    assert home.get("membership_status") == "pending"
    _activate(client, auth, sub)
    home2 = client.get("/subscriber/home", headers=headers).json()
    titles2 = [r.get("title") for r in home2.get("resources") or []]
    assert "Réservé inscrits" in titles2


def test_guest_invite_and_redeem(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-invite@example.com",
            "password": "secretpass123",
            "workspace_name": "Invitations",
        },
    )
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    slug = reg.json()["workspace"]["slug"]
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})
    invited = client.post(
        "/storefront/participants/invite",
        headers=auth,
        json={"email": "invitee@example.com", "display_name": "Invité"},
    )
    assert invited.status_code == 200, invited.text
    participant = invited.json()["participant"]
    assert participant.get("status") == "guest"
    code = participant.get("invite_code")
    assert code
    redeem = client.post(
        "/auth/redeem-invite",
        json={
            "email": "invitee@example.com",
            "code": code,
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    assert redeem.status_code == 200, redeem.text
    assert redeem.json().get("membership_status") == "active"
    home = client.get(
        "/subscriber/home",
        headers={"Authorization": f"Bearer {redeem.json()['token']}"},
    )
    assert home.status_code == 200, home.text
    assert home.json().get("membership_status") == "active"


def test_selected_visibility_uses_participant_user_ids(client):
    from datetime import datetime, timedelta

    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-uids@example.com",
            "password": "secretpass123",
            "workspace_name": "Nominatif Users",
        },
    )
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    slug = reg.json()["workspace"]["slug"]
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})
    alice = client.post(
        "/auth/register-subscriber",
        json={"email": "alice-uid@example.com", "password": "secretpass123", "workspace_slug": slug},
    )
    bob = client.post(
        "/auth/register-subscriber",
        json={"email": "bob-uid@example.com", "password": "secretpass123", "workspace_slug": slug},
    )
    _activate(client, auth, alice)
    _activate(client, auth, bob)
    alice_id = alice.json()["user"]["id"]
    opened = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    ev = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Dossier Alice UID",
            "starts_at": opened,
            "event_type": "ressource",
            "visibility": "selected",
            "audience_user_ids": [alice_id],
            "resource_type": "document",
            "resource_url": "https://example.com/alice-uid",
        },
    )
    assert ev.status_code == 200, ev.text
    assert alice_id in (ev.json().get("audience_user_ids") or [])
    home_a = client.get("/subscriber/home", headers={"Authorization": f"Bearer {alice.json()['token']}"}).json()
    home_b = client.get("/subscriber/home", headers={"Authorization": f"Bearer {bob.json()['token']}"}).json()
    assert any(r.get("title") == "Dossier Alice UID" for r in home_a.get("resources") or [])
    assert not any(r.get("title") == "Dossier Alice UID" for r in home_b.get("resources") or [])
