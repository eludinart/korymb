"""Isolation multi-tenant : secret agent + X-Workspace-Id, fichiers sans repli legacy."""
from __future__ import annotations


def test_agent_secret_honors_workspace_header(client, test_secret):
    reg = client.post(
        "/auth/register",
        json={
            "email": "tenant-iso@example.com",
            "password": "secretpass123",
            "workspace_name": "Espace Iso",
        },
    )
    assert reg.status_code == 200, reg.text
    ws_id = reg.json()["workspace"]["id"]

    bad = client.get(
        "/jobs/light",
        headers={"X-Agent-Secret": test_secret, "X-Workspace-Id": "ws-does-not-exist"},
    )
    assert bad.status_code == 404

    ok = client.get(
        "/jobs/light",
        headers={"X-Agent-Secret": test_secret, "X-Workspace-Id": ws_id},
    )
    assert ok.status_code == 200, ok.text

    legacy = client.get("/jobs/light", headers={"X-Agent-Secret": test_secret})
    assert legacy.status_code == 200


def test_resource_file_no_cross_tenant_legacy_fallback(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    from services.resource_files import load_local_file, save_upload
    from tenant_context import clear_tenant_context, set_tenant_context
    from workspace_db import _DEFAULT_WORKSPACE_ID

    clear_tenant_context()
    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    saved = save_upload(
        filename="secret-legacy.txt",
        mime="text/plain",
        data=b"legacy-only",
    )
    assert saved.get("success")
    fid = str((saved.get("file") or {}).get("id") or "")
    assert fid.startswith("rfil-")

    set_tenant_context(workspace_id="ws-other-fake")
    assert load_local_file(fid, workspace_id="ws-other-fake") is None

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    item = load_local_file(fid, workspace_id=_DEFAULT_WORKSPACE_ID)
    assert item is not None
    from services.resource_files import read_file_bytes

    assert b"legacy-only" in read_file_bytes(item)
