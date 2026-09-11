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

    ag.update_group_members(gid, policy={**ag.default_group_policy(), "memory_scope": "none"})
    assert ag.group_memory_scope(gid) == "none"

    ag.update_group_members(gid, policy={**ag.default_group_policy(), "memory_scope": "enterprise"})
    assert ag.group_memory_scope(gid) == "enterprise"
