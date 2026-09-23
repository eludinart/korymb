"""Starter packs : catalogue, application à la création, idempotence."""
from __future__ import annotations

from database import get_enterprise_memory, list_mission_templates, list_playbooks
from services.starter_packs import STARTER_PACKS, apply_starter_pack, list_starter_packs
from tenant_context import set_tenant_context


def test_list_starter_packs_catalog():
    packs = list_starter_packs()
    ids = {p["id"] for p in packs}
    assert ids == {"blank", "accompagnement", "contenu"}
    assert all("label" in p and "description" in p for p in packs)
    acc = next(p for p in packs if p["id"] == "accompagnement")
    assert acc["playbook_count"] >= 4
    assert acc["has_memory_seed"] is True


def test_auth_list_starter_packs(client):
    r = client.get("/auth/starter-packs")
    assert r.status_code == 200, r.text
    packs = r.json().get("packs") or []
    assert {p["id"] for p in packs} == {"blank", "accompagnement", "contenu"}


def test_register_blank_has_no_metier_playbooks(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "pack-blank@example.com",
            "password": "secretpass123",
            "workspace_name": "Blank Pack WS",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    body = reg.json()
    token = body["token"]
    wid = body["workspace"]["id"]
    assert (body["workspace"].get("starter_pack_id") or "blank") in ("", "blank")

    set_tenant_context(workspace_id=wid)
    pbs = list_playbooks()
    assert not any(str(p.get("id") or "").startswith("pack-accompagnement-") for p in pbs)
    assert not any(str(p.get("category") or "") == "accompagnement" for p in pbs)

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert (me.json().get("workspace") or {}).get("starter_pack_id") in ("", "blank")


def test_register_accompagnement_creates_playbooks_and_memory(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "pack-acc@example.com",
            "password": "secretpass123",
            "workspace_name": "Acc Pack WS",
            "starter_pack_id": "accompagnement",
        },
    )
    assert reg.status_code == 200, reg.text
    body = reg.json()
    token = body["token"]
    wid = body["workspace"]["id"]
    assert body["workspace"].get("starter_pack_id") == "accompagnement"

    set_tenant_context(workspace_id=wid)
    pbs = list_playbooks()
    pack_pbs = [p for p in pbs if str(p.get("id") or "").startswith("pack-accompagnement-")]
    assert len(pack_pbs) == len(STARTER_PACKS["accompagnement"]["playbooks"])
    names = {p["name"] for p in pack_pbs}
    assert "Notes de séance → fiche de suivi" in names

    tpls = list_mission_templates()
    assert any(str(t.get("id") or "").startswith("pack-accompagnement-") for t in tpls)

    mem = get_enterprise_memory()
    global_ctx = str((mem.get("contexts") or {}).get("global") or "")
    assert "accompagnement" in global_ctx.lower() or "confidentialité" in global_ctx.lower()

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["workspace"]["starter_pack_id"] == "accompagnement"


def test_apply_starter_pack_idempotent(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "pack-idem@example.com",
            "password": "secretpass123",
            "workspace_name": "Idem Pack WS",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    wid = reg.json()["workspace"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    first = client.post(
        "/auth/workspaces/apply-starter-pack",
        headers=headers,
        json={"starter_pack_id": "contenu"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["created_playbooks"] == len(STARTER_PACKS["contenu"]["playbooks"])
    assert first.json()["starter_pack_id"] == "contenu"

    second = client.post(
        "/auth/workspaces/apply-starter-pack",
        headers=headers,
        json={"starter_pack_id": "contenu"},
    )
    assert second.status_code == 200, second.text
    assert second.json()["created_playbooks"] == 0
    assert second.json()["skipped_playbooks"] == len(STARTER_PACKS["contenu"]["playbooks"])

    set_tenant_context(workspace_id=wid)
    pack_pbs = [
        p for p in list_playbooks() if str(p.get("id") or "").startswith("pack-contenu-")
    ]
    assert len(pack_pbs) == len(STARTER_PACKS["contenu"]["playbooks"])


def test_apply_unknown_pack_rejected(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "pack-bad@example.com",
            "password": "secretpass123",
            "workspace_name": "Bad Pack WS",
        },
    )
    token = reg.json()["token"]
    r = client.post(
        "/auth/workspaces/apply-starter-pack",
        headers={"Authorization": f"Bearer {token}"},
        json={"starter_pack_id": "secteur-inexistant"},
    )
    assert r.status_code == 400


def test_create_workspace_with_pack(client):
    reg = client.post(
        "/auth/register",
        json={
            "email": "pack-create@example.com",
            "password": "secretpass123",
            "workspace_name": "Root WS",
        },
    )
    token = reg.json()["token"]
    created = client.post(
        "/auth/workspaces",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Secondaire Contenu", "starter_pack_id": "contenu"},
    )
    assert created.status_code == 200, created.text
    ws = created.json()["workspace"]
    assert ws.get("starter_pack_id") == "contenu"
    set_tenant_context(workspace_id=ws["id"])
    assert any(str(p.get("id") or "").startswith("pack-contenu-") for p in list_playbooks())
