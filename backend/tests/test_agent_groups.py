"""Tests groupes d'agents + blueprints."""
from __future__ import annotations


def test_normalize_and_confirm_blueprint(tmp_path, monkeypatch):
    import database as db
    from services import agent_groups as ag
    from services.agents import refresh_agents_definitions_cache

    monkeypatch.setenv("KORYMB_DB_BACKEND", "sqlite")
    # Force sqlite path isolé si possible
    db.init_db()
    ag.ensure_enterprise_group()
    groups = ag.list_groups()
    assert any(g["id"] == "entreprise" for g in groups)

    bp = ag.create_blueprint_proposal(
        {
            "label": "Livre test",
            "intent": "Écrire un livre sur les 8 formes d'amour",
            "lead": {
                "key": "editeur_livre_test",
                "label": "Éditeur",
                "role": "Pilotition",
                "system": "Tu es éditeur.",
                "tools": ["web", "drive"],
            },
            "members": [
                {
                    "key": "narrateur_livre_test",
                    "label": "Narrateur",
                    "role": "Rédaction",
                    "system": "Tu rédiges.",
                    "tools": ["web"],
                }
            ],
            "out_of_scope": ["posts Instagram"],
            "simulation": "Chapitre 1 d'abord.",
            "risks": ["Ton à valider"],
        }
    )
    assert bp["status"] == "proposed"
    assert "Éditeur" in bp["dry_run_summary"] or "éditeur" in bp["dry_run_summary"].lower()

    result = ag.confirm_blueprint(bp["id"])
    assert result["ok"] is True
    gid = result["group"]["id"]
    g = ag.get_group(gid)
    assert g is not None
    assert g["lead_agent_key"] == "editeur_livre_test"
    assert "narrateur_livre_test" in g["member_keys"]

    allowed = ag.group_allowed_delegate_keys(gid)
    assert allowed is not None
    assert "narrateur_livre_test" in allowed
    assert "commercial" not in allowed

    refresh_agents_definitions_cache()
    from services.agents import agents_def, delegatable_subagent_keys_ordered

    assert "editeur_livre_test" in agents_def()
    scoped = delegatable_subagent_keys_ordered(allowed_keys=allowed)
    assert "narrateur_livre_test" in scoped
    assert "commercial" not in scoped


def test_templates_list():
    from services.agent_groups import list_group_templates

    keys = {t["key"] for t in list_group_templates()}
    assert "edition" in keys
    assert "terrain" in keys
    assert "rd_tech" in keys


def test_assistant_in_builtins():
    from services.agents import BUILTIN_AGENT_DEFINITIONS

    assert "assistant" in BUILTIN_AGENT_DEFINITIONS
    assert BUILTIN_AGENT_DEFINITIONS["assistant"].get("is_manager") is True


def test_group_memory_scope_and_format(app):
    import database as db
    from services import agent_groups as ag

    ag.ensure_enterprise_group()

    gid = "grp_mem_test"
    db.upsert_agent_group(
        gid,
        slug="mem_test",
        label="Mémoire test",
        description="équipe mémoire",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=["commercial"],
        policy={**ag.default_group_policy(), "memory_scope": "group"},
        is_system=False,
        template_key=None,
    )
    assert ag.group_memory_scope(gid) == "group"

    mem = ag.set_group_memory(gid, notes="Brief projet Alpha. Glossaire: FOO=bar.", inherit_shared=False)
    assert "Alpha" in mem["notes"]
    assert mem["inherit_shared"] is False

    prompt = ag.format_group_memory_prompt(gid)
    assert "Mémoire d'équipe" in prompt
    assert "Brief projet Alpha" in prompt
    assert "Mémoire partagée (héritée)" not in prompt

    ag.set_group_memory(gid, inherit_shared=True)
    prompt2 = ag.format_group_memory_prompt(gid)
    assert "Brief projet Alpha" in prompt2

    ser = ag.get_group(gid)
    assert ser is not None
    assert ser["memory_scope"] == "group"
    assert ser["inherit_shared"] is True
    assert ser["sees_workspace_identity"] is True

    ag.update_group_members(gid, policy={**ag.default_group_policy(), "memory_scope": "none"})
    assert ag.group_memory_scope(gid) == "none"
    ser_none = ag.get_group(gid)
    assert ser_none["sees_workspace_identity"] is False

    ag.update_group_members(gid, policy={**ag.default_group_policy(), "memory_scope": "enterprise"})
    assert ag.group_memory_scope(gid) == "enterprise"


def test_agent_groups_api_exposes_perimeter(client):
    from services import agent_groups as ag

    ag.ensure_enterprise_group()
    r = client.get("/agent-groups")
    assert r.status_code == 200
    groups = r.json()["groups"]
    ent = next(g for g in groups if g["id"] == "entreprise")
    assert ent["memory_scope"] == "enterprise"
    assert ent["sees_workspace_identity"] is True
    assert "inherit_shared" in ent


def test_isolated_group_does_not_get_fleur_brand(app):
    """Une équipe memory_scope=group sans héritage ne reçoit pas le pack Fleur d'Amours."""
    import database as db
    from services import agent_groups as ag
    from services.workspace_brand import (
        group_sees_workspace_identity,
        workspace_identity_block,
    )
    from tenant_context import set_tenant_context

    set_tenant_context(workspace_id="ws-default-legacy")
    ag.ensure_enterprise_group()

    gid = "grp_fleur_leak"
    db.upsert_agent_group(
        gid,
        slug="livre_isolé",
        label="Livre isolé",
        description="équipe édition isolée",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=["narrateur"],
        policy={**ag.default_group_policy(), "memory_scope": "group"},
        is_system=False,
        template_key="edition",
    )
    ag.set_group_memory(gid, notes="Ouvrage : cycle végétal imaginaire.", inherit_shared=False)

    assert group_sees_workspace_identity(None) is True
    assert group_sees_workspace_identity("entreprise") is True
    assert group_sees_workspace_identity(gid) is False

    isolated = workspace_identity_block(gid).lower()
    assert "fleur" not in isolated
    assert "élude" not in isolated and "elude" not in isolated
    assert "mémoire d'équipe" in isolated or "memoire d'equipe" in isolated.replace("é", "e")

    shared = workspace_identity_block(None).lower()
    assert "fleur" in shared

    ag.set_group_memory(gid, inherit_shared=True)
    assert group_sees_workspace_identity(gid) is True
    inherited = workspace_identity_block(gid).lower()
    assert "fleur" in inherited


def test_isolated_group_memory_omits_drive_index(app):
    import database as db
    from services import agent_groups as ag
    from services.mission import _korymb_memory_prompt_for

    ag.ensure_enterprise_group()
    gid = "grp_drive_isol"
    db.upsert_agent_group(
        gid,
        slug="drive_isol",
        label="Drive isol",
        description="",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=[],
        policy={**ag.default_group_policy(), "memory_scope": "group"},
        is_system=False,
        template_key=None,
    )
    ag.set_group_memory(gid, notes="Brief Projet Zeta uniquement.", inherit_shared=False)

    prompt = _korymb_memory_prompt_for("narrateur", agent_group_id=gid)
    assert "Projet Zeta" in prompt
    assert "Espace fichiers Korymb" not in prompt
    assert "Fleur" not in prompt


def test_cannot_delete_entreprise(client):
    from services import agent_groups as ag

    ag.ensure_enterprise_group()
    preview = client.get("/admin/agent-groups/entreprise/delete-preview")
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_delete"] is False
    assert body["is_system"] is True

    r = client.delete("/admin/agent-groups/entreprise")
    assert r.status_code == 400
    assert ag.get_group("entreprise") is not None


def test_delete_group_blocked_by_job(client):
    import database as db
    from services import agent_groups as ag

    ag.ensure_enterprise_group()
    gid = "grp_del_block"
    db.upsert_agent_group(
        gid,
        slug="del_block",
        label="Flotte bloquée",
        description="",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=[],
        policy=ag.default_group_policy(),
        is_system=False,
        template_key=None,
    )
    db.save_job(
        "jobdelblk1",
        "coordinateur",
        "Mission encore liée",
        source="mission",
        mission_config={"agent_group_id": gid},
    )
    preview = client.get(f"/admin/agent-groups/{gid}/delete-preview")
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_delete"] is False
    assert body["jobs_count"] >= 1

    r = client.delete(f"/admin/agent-groups/{gid}")
    assert r.status_code == 409
    assert ag.get_group(gid) is not None


def test_delete_empty_group_ok(client):
    import database as db
    from services import agent_groups as ag
    from services.agents import agents_def

    ag.ensure_enterprise_group()
    gid = "grp_del_ok"
    db.upsert_custom_agent(
        "editeur_del_ok",
        label="Éditeur jetable",
        role="Rédaction",
        system_prompt="Tu rédiges.",
        tools=["web"],
    )
    db.upsert_agent_group(
        gid,
        slug="del_ok",
        label="Flotte vide",
        description="",
        status="active",
        lead_agent_key="editeur_del_ok",
        member_keys=[],
        policy=ag.default_group_policy(),
        is_system=False,
        template_key=None,
    )
    preview = client.get(f"/admin/agent-groups/{gid}/delete-preview")
    assert preview.status_code == 200
    body = preview.json()
    assert body["can_delete"] is True
    assert any(a["key"] == "editeur_del_ok" for a in body["exclusive_agents"])

    r = client.delete(f"/admin/agent-groups/{gid}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert ag.get_group(gid) is None
    assert "editeur_del_ok" not in agents_def()
