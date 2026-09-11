"""Upload et téléchargement des ressources planning."""
from __future__ import annotations

from datetime import datetime, timedelta


def test_upload_resource_and_subscriber_download(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))

    reg = client.post(
        "/auth/register",
        json={
            "email": "dirigeant-fichier@example.com",
            "password": "secretpass123",
            "workspace_name": "Atelier Fichier",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    slug = reg.json()["workspace"]["slug"]
    auth = {"Authorization": f"Bearer {token}"}
    client.patch("/storefront/settings", headers=auth, json={"public_enabled": True})

    uploaded = client.post(
        "/business/resource-files",
        headers=auth,
        files={"file": ("module-1.pdf", b"%PDF-1.4 korymb-resource", "application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.text
    file_meta = uploaded.json().get("file") or {}
    assert file_meta.get("id", "").startswith("rfil-")

    opened = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    future = (datetime.utcnow() + timedelta(days=4)).isoformat()
    ev = client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Module PDF",
            "starts_at": opened,
            "event_type": "ressource",
            "nature": "matiere",
            "modality": "async",
            "is_public": True,
            "visibility": "participants",
            "resource_type": "document",
            "resource_file_id": file_meta["id"],
        },
    )
    assert ev.status_code == 200, ev.text
    event_id = ev.json()["id"]
    assert ev.json().get("resource_filename") == "module-1.pdf"

    later = client.post(
        "/business/resource-files",
        headers=auth,
        files={"file": ("secret.mp3", b"ID3korymb", "audio/mpeg")},
    )
    client.post(
        "/business/events",
        headers=auth,
        json={
            "title": "Podcast à venir",
            "starts_at": future,
            "event_type": "ressource",
            "nature": "matiere",
            "is_public": True,
            "visibility": "participants",
            "resource_type": "podcast",
            "resource_file_id": later.json()["file"]["id"],
        },
    )

    public = client.get(f"/public/storefront/{slug}").json()
    for item in public.get("resources_upcoming") or []:
        assert "resource_url" not in item
        assert "has_file" not in item
        assert "resource_file_id" not in item

    sub = client.post(
        "/auth/register-subscriber",
        json={
            "email": "eleve-fichier@example.com",
            "password": "secretpass123",
            "workspace_slug": slug,
        },
    )
    uid = (sub.json().get("user") or {}).get("id")
    assert client.post(f"/storefront/participants/{uid}/validate", headers=auth).status_code == 200
    sub_headers = {"Authorization": f"Bearer {sub.json()['token']}", "X-Agent-Secret": ""}
    home = client.get("/subscriber/home", headers=sub_headers).json()
    unlocked = home.get("resources") or []
    match = next(r for r in unlocked if r.get("title") == "Module PDF")
    assert match.get("has_file") is True
    assert match.get("resource_filename") == "module-1.pdf"
    assert "resource_file_id" not in match

    dl = client.get(f"/subscriber/events/{event_id}/file", headers=sub_headers)
    assert dl.status_code == 200, dl.text
    assert dl.content == b"%PDF-1.4 korymb-resource"
    disp = dl.headers.get("content-disposition") or ""
    assert "Module" in disp and ".pdf" in disp

    upcoming = next(r for r in home.get("resources_upcoming") or [] if r.get("title") == "Podcast à venir")
    locked = client.get(f"/subscriber/events/{upcoming['id']}/file", headers=sub_headers)
    assert locked.status_code == 404

    op_dl = client.get(f"/business/resource-files/{file_meta['id']}", headers=auth)
    assert op_dl.status_code == 200
    assert op_dl.content == b"%PDF-1.4 korymb-resource"


def test_reject_executable_resource(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    uploaded = client.post(
        "/business/resource-files",
        files={"file": ("virus.exe", b"MZ", "application/octet-stream")},
    )
    assert uploaded.status_code == 422


def test_load_file_falls_back_to_default_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    from tenant_context import clear_tenant_context, set_tenant_context
    from services.resource_files import load_local_file, save_upload

    set_tenant_context(workspace_id="ws-default-legacy")
    saved = save_upload(filename="prospects.csv", mime="text/csv", data=b"nom,ville\nAda,Nice\n")
    assert saved.get("success")
    fid = saved["file"]["id"]
    set_tenant_context(workspace_id="ws-other-space")
    item = load_local_file(fid)
    assert item is not None
    assert item["filename"] == "prospects.csv"
    clear_tenant_context()


def test_spawn_thread_writes_into_current_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    import threading

    from tenant_context import clear_tenant_context, set_tenant_context, spawn_thread
    from services.resource_files import save_upload

    done = threading.Event()
    out: dict[str, str] = {}

    def work() -> None:
        try:
            saved = save_upload(filename="x.csv", mime="text/csv", data=b"n\n1\n")
            out["id"] = str((saved.get("file") or {}).get("id") or "")
        finally:
            done.set()

    set_tenant_context(workspace_id="ws-custom-aaa", user_id="usr-1")
    spawn_thread(work, name="t-test-tenant")
    assert done.wait(5)
    clear_tenant_context()
    fid = out.get("id") or ""
    assert fid.startswith("rfil-")
    assert (tmp_path / "ws-custom-aaa" / fid).is_file()
