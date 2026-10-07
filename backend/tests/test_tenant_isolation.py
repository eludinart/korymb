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


def test_new_workspace_inbox_hides_other_tenant_business(client):
    """Un espace neuf ne voit pas les décisions métier (CRM, missions, notifications) d'un autre."""
    from database import (
        insert_config_suggestion,
        insert_director_notification,
        insert_learning_suggestion,
    )
    from services.director_platform import build_briefing, build_enriched_inbox
    from tenant_context import set_tenant_context
    from workspace_db import _DEFAULT_WORKSPACE_ID

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    insert_config_suggestion(
        kind="crm_write",
        target_key="crm-leak-delie",
        title="CRM chat — DELIE Lionel",
        body="fiche d'un autre espace",
        payload={"name": "DELIE Lionel"},
    )
    insert_config_suggestion(
        kind="budget",
        target_key="job:leak-tokens",
        title="Mission à coût tokens élevé",
        body="mission d'un autre espace",
        payload={"job_id": "leak-tokens"},
    )
    insert_learning_suggestion("job-leak", {"title": "Mémoire client Sonia"})
    insert_director_notification(kind="info", title="Relance Camilleri Laetitia", body="autre espace")

    reg = client.post(
        "/auth/register",
        json={
            "email": "mer-decouverte-83@example.com",
            "password": "secretpass123",
            "workspace_name": "mer et découverte 83",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    ws_id = reg.json()["workspace"]["id"]
    assert ws_id != _DEFAULT_WORKSPACE_ID

    inbox = client.get("/admin/inbox", headers={"Authorization": f"Bearer {token}"})
    assert inbox.status_code == 200, inbox.text
    blob = inbox.text
    assert "DELIE Lionel" not in blob
    assert "Camilleri" not in blob
    assert "Sonia" not in blob
    assert "coût tokens élevé" not in blob

    briefing = client.get("/admin/briefing", headers={"Authorization": f"Bearer {token}"})
    assert briefing.status_code == 200, briefing.text
    brief = briefing.text
    assert "DELIE Lionel" not in brief
    assert "Camilleri" not in brief
    assert "Sonia" not in brief
    assert "coût tokens élevé" not in brief

    set_tenant_context(workspace_id=ws_id)
    fresh = build_enriched_inbox(limit=40)
    titles = " ".join(str(i.get("title") or "") for i in fresh["items"])
    assert "DELIE" not in titles
    assert fresh["total"] == 0 or "CRM chat" not in titles

    home = build_briefing()
    dumped = str(home.get("decisions_today") or "") + str(home.get("executive_summary") or "")
    assert "DELIE" not in dumped
    assert int(home.get("notifications_unread") or 0) == 0


def test_new_workspace_has_only_principal_agents(client):
    """Une équipe custom d'un autre espace n'est pas reprise. Seule la flotte principale est créée."""
    import database as db
    from services.agent_groups import ENTERPRISE_GROUP_ID
    from tenant_context import set_tenant_context
    from workspace_db import _DEFAULT_WORKSPACE_ID

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    db.upsert_agent_group(
        "grp-leak-livre",
        slug="livre-leak",
        label="Livre test",
        description="équipe d'un autre espace",
        status="active",
        lead_agent_key="editeur_livre_test",
        member_keys=["narrateur_livre_test"],
        policy={},
        is_system=False,
        template_key=None,
    )
    db.upsert_custom_agent(
        "editeur_livre_test",
        label="Éditeur",
        role="autre espace",
        system_prompt="Tu édites un livre pour un autre espace.",
        tools=["web"],
    )

    reg = client.post(
        "/auth/register",
        json={
            "email": "flotte-vierge@example.com",
            "password": "secretpass123",
            "workspace_name": "Espace flotte vierge",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]

    groups = client.get("/agent-groups", headers={"Authorization": f"Bearer {token}"})
    assert groups.status_code == 200, groups.text
    rows = groups.json()["groups"]
    assert len(rows) == 1
    fleet = rows[0]
    assert fleet["id"] == ENTERPRISE_GROUP_ID
    assert fleet["is_system"] is True
    assert "Livre" not in str(fleet.get("label") or "")
    assert fleet["lead_agent_key"] == "coordinateur"
    assert set(fleet.get("member_keys") or []) == {
        "commercial",
        "community_manager",
        "developpeur",
        "comptable",
    }

    agents = client.get("/agents", headers={"Authorization": f"Bearer {token}"})
    assert agents.status_code == 200, agents.text
    keys = {str(a.get("key") or "") for a in agents.json().get("agents") or []}
    assert "editeur_livre_test" not in keys
    assert "narrateur_livre_test" not in keys
    assert "coordinateur" in keys


def test_new_workspace_reprise_audit_is_empty(client):
    from database import upsert_reprise_checklist_action
    from tenant_context import set_tenant_context
    from workspace_db import _DEFAULT_WORKSPACE_ID

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    upsert_reprise_checklist_action(
        domain_id="editorial_tarot",
        item_text="Lister les éditeurs tarot de l'autre espace",
        action="validated",
        note="DELIE Lionel",
    )

    reg = client.post(
        "/auth/register",
        json={
            "email": "reprise-vierge@example.com",
            "password": "secretpass123",
            "workspace_name": "Espace reprise vierge",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    cov = client.get("/admin/reprise/coverage", headers={"Authorization": f"Bearer {token}"})
    assert cov.status_code == 200, cov.text
    body = cov.json()
    assert body.get("workspace_empty") is True
    assert body.get("gaps") == []
    assert body.get("domains") == []
    assert "DELIE" not in cov.text
    assert "tarot" not in cov.text.lower()


def test_new_workspace_engine_settings_are_generic_and_isolated(client):
    from database import get_orchestration_prompt, upsert_behavior_setting, upsert_orchestration_prompt
    from services.behavior_defaults import BEHAVIOR_DEFAULTS
    from services.orchestration_prompt_defaults import ACTIVITY_CONTEXT_PHRASE, branded_factory_body
    from tenant_context import set_tenant_context
    from workspace_db import _DEFAULT_WORKSPACE_ID

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    upsert_orchestration_prompt(
        "cio_synthesis_solo_suffix",
        branded_factory_body("cio_synthesis_solo_suffix") + "\nMARQUE-LEGACY-SEULE",
    )
    upsert_behavior_setting("orchestration.tools.sandbox_execute", "LEGACY_ONLY_SANDBOX")

    reg = client.post(
        "/auth/register",
        json={
            "email": "moteur-vierge@example.com",
            "password": "secretpass123",
            "workspace_name": "Espace moteur vierge",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    new_ws = reg.json()["workspace"]["id"]

    set_tenant_context(workspace_id=new_ws)
    upsert_orchestration_prompt(
        "cio_synthesis_with_team_user",
        branded_factory_body("cio_synthesis_with_team_user"),
    )
    upsert_orchestration_prompt(
        "cio_synthesis_solo_suffix",
        branded_factory_body("cio_synthesis_solo_suffix") + "\nNOTE-PERSO-ESPACE",
    )

    prompts = client.get("/admin/orchestration-prompts", headers=headers)
    assert prompts.status_code == 200, prompts.text
    bodies = {p["prompt_key"]: p["body"] for p in prompts.json()["prompts"]}
    assert "MARQUE-LEGACY-SEULE" not in prompts.text
    assert "LEGACY_ONLY_SANDBOX" not in prompts.text
    assert "sous_taches" in bodies["cio_plan_json_user"]
    assert ACTIVITY_CONTEXT_PHRASE in bodies["cio_synthesis_with_team_user"]
    assert "Elude" not in bodies["cio_synthesis_with_team_user"]
    assert "NOTE-PERSO-ESPACE" in bodies["cio_synthesis_solo_suffix"]
    assert "QUESTIONS STRATEGIQUES" in bodies["cio_synthesis_solo_suffix"]

    behaviors = client.get("/admin/behavior-settings", headers=headers)
    assert behaviors.status_code == 200, behaviors.text
    settings = {s["setting_key"]: s["value"] for s in behaviors.json()["settings"]}
    assert "LEGACY_ONLY_SANDBOX" not in behaviors.text
    assert set(settings) == set(BEHAVIOR_DEFAULTS)
    assert settings["orchestration.engine"] == "legacy"
    assert settings["orchestration.tools.sandbox_execute"] is True
    assert settings["orchestration.strict_lazy_delegation"] is True
    assert settings["learning.auto_apply_mode"] == "safe"

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    legacy_body = get_orchestration_prompt("cio_synthesis_solo_suffix") or ""
    assert "MARQUE-LEGACY-SEULE" in legacy_body


def test_new_workspace_history_hides_other_tenant(client):
    from database import (
        append_agent_definition_history,
        list_agent_definition_history,
        save_job,
        snapshot_memory_history,
    )
    from tenant_context import set_tenant_context
    from workspace_db import _DEFAULT_WORKSPACE_ID

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    legacy = client.post(
        "/mission-sessions",
        json={"agent": "coordinateur", "title": "Cadrage DELIE Lionel historique"},
    )
    assert legacy.status_code == 200, legacy.text
    legacy_sid = legacy.json()["id"]
    save_job("joblegacy1", "coordinateur", "Mission historique DELIE Lionel")
    snapshot_memory_history("Mémoire historique DELIE Lionel")
    append_agent_definition_history("commercial", {"label": "Fiche historique DELIE Lionel"})

    reg = client.post(
        "/auth/register",
        json={
            "email": "historique-vierge@example.com",
            "password": "secretpass123",
            "workspace_name": "Espace historique vierge",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['token']}"}

    sessions = client.get("/mission-sessions?limit=200", headers=headers)
    assert sessions.status_code == 200, sessions.text
    assert sessions.json()["sessions"] == []
    assert "DELIE" not in sessions.text

    denied = client.get(f"/mission-sessions/{legacy_sid}", headers=headers)
    assert denied.status_code == 404
    removed = client.delete(f"/mission-sessions/{legacy_sid}", headers=headers)
    assert removed.status_code == 404

    cards = client.get("/jobs/cards", headers=headers)
    assert cards.status_code == 200, cards.text
    assert cards.json()["jobs"] == []
    assert "DELIE" not in cards.text

    memory = client.get("/memory/history?limit=30", headers=headers)
    assert memory.status_code == 200, memory.text
    assert "DELIE" not in memory.text

    agents = client.get("/admin/agents/custom/commercial/history", headers=headers)
    assert agents.status_code == 200, agents.text
    assert "DELIE" not in agents.text

    own = client.post(
        "/mission-sessions",
        json={"agent": "coordinateur", "title": "Sortie en mer"},
        headers=headers,
    )
    assert own.status_code == 200, own.text
    again = client.get("/mission-sessions?limit=200", headers=headers)
    assert [s.get("title") for s in again.json()["sessions"]] == ["Sortie en mer"]

    still = client.get("/mission-sessions?limit=200")
    assert any(s.get("id") == legacy_sid for s in still.json()["sessions"])
    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    assert any("DELIE" in str(row) for row in list_agent_definition_history("commercial"))


def test_new_workspace_does_not_inherit_library_or_llm_file(client, tmp_path, monkeypatch):
    import json

    from database import dismiss_library_item, list_library_dismissed_item_ids
    from runtime_settings import _read_disk_raw
    from tenant_context import set_tenant_context
    from workspace_db import _DEFAULT_WORKSPACE_ID

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    dismiss_library_item("group:DELIE-LIBRARY")
    assert "group:DELIE-LIBRARY" in list_library_dismissed_item_ids()

    marker = tmp_path / "runtime_settings.json"
    marker.write_text(
        json.dumps({"llm_provider": "mistral", "mistral_model": "modele-legacy-seulement"}),
        encoding="utf-8",
    )
    monkeypatch.setattr("runtime_settings.PATH", marker)
    monkeypatch.setattr("runtime_settings._MIGRATED_FROM_FILE", False)

    reg = client.post(
        "/auth/register",
        json={
            "email": "neutre-depart@example.com",
            "password": "secretpass123",
            "workspace_name": "Espace neutre depart",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    new_ws = reg.json()["workspace"]["id"]
    set_tenant_context(workspace_id=new_ws)
    assert "group:DELIE-LIBRARY" not in list_library_dismissed_item_ids()
    assert _read_disk_raw().get("mistral_model") != "modele-legacy-seulement"

    set_tenant_context(workspace_id=_DEFAULT_WORKSPACE_ID)
    assert "group:DELIE-LIBRARY" in list_library_dismissed_item_ids()
