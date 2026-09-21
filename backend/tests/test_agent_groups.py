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
    assert "posts Instagram" in ((g.get("policy") or {}).get("out_of_scope") or [])

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


def test_project_team_isolates_enterprise_science(app):
    """Une équipe projet (memory_scope=group) ne reçoit pas la science d'entreprise."""
    from database import merge_enterprise_contexts
    from services import agent_groups as ag
    from services.knowledge import build_entity_context_block, upsert_entity
    from services.mission import _cio_prompt_memory, _korymb_memory_prompt_for, _scoped_brand_context

    ag.ensure_enterprise_group()
    marker = "SCIENCE-ENTREPRISE-MARKER-ZX9"
    merge_enterprise_contexts({"global": f"Opérations globales : {marker}. CRM, prospection, facturation."})

    gid = "grp_scope_iso"
    import database as db

    db.upsert_agent_group(
        gid,
        slug="scope_iso",
        label="Roman isolé",
        description="écrire un roman",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=["commercial"],
        policy={**ag.default_group_policy(), "memory_scope": "group", "out_of_scope": ["prospection commerciale"]},
        is_system=False,
        template_key="edition",
    )
    ag.set_group_memory(gid, notes="Brief : chapitre 1 du roman.", inherit_shared=False)

    assert ag.group_uses_enterprise_science(gid) is False
    assert ag.group_uses_enterprise_science("entreprise") is True
    assert ag.group_uses_enterprise_science(None) is True

    assert marker not in ag.brand_context_for_group(gid)
    assert marker in ag.brand_context_for_group("entreprise")
    assert marker not in _scoped_brand_context(gid)

    group_mem = _korymb_memory_prompt_for("coordinateur", agent_group_id=gid)
    assert "chapitre 1" in group_mem.lower() or "Brief" in group_mem
    assert marker not in group_mem
    assert "Historique missions Korymb" not in group_mem

    cio_mem = _cio_prompt_memory(
        "coordinateur", exclude_job_id=None, chat_mode=False, agent_group_id=gid
    )
    assert marker not in cio_mem
    assert "Contexte global entreprise" not in cio_mem
    assert "Reste strictement sur la consigne" in cio_mem
    assert "prospection commerciale" in cio_mem

    scope = ag.format_group_scope_prompt(gid)
    assert "Science d'entreprise : non injectée" in scope
    assert "Hors périmètre déclaré" in scope

    upsert_entity(
        "ProspectAcmeGlobal",
        "company",
        {"pipeline": "prospection Q3", "note": marker},
        {},
    )
    isolated = build_entity_context_block("écrire le chapitre 1 du roman", agent_group_id=gid)
    assert "ProspectAcmeGlobal" not in isolated
    enterprise_entities = build_entity_context_block("écrire le chapitre 1 du roman", agent_group_id="entreprise")
    assert "ProspectAcmeGlobal" in enterprise_entities


def test_inherit_shared_does_not_dump_full_enterprise_layers(app):
    """inherit_shared n'ajoute qu'un extrait global, pas l'historique ni FLEUR_CONTEXT."""
    from database import merge_enterprise_contexts
    from services import agent_groups as ag
    from services.mission import _cio_prompt_memory, _scoped_brand_context

    ag.ensure_enterprise_group()
    marker = "SCIENCE-INHERIT-MARKER-QY7"
    merge_enterprise_contexts({"global": f"Identité workspace {marker}"})

    gid = "grp_inherit_iso"
    import database as db

    db.upsert_agent_group(
        gid,
        slug="inherit_iso",
        label="Terrain isolé",
        description="stage terrain",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=["commercial"],
        policy={**ag.default_group_policy(), "memory_scope": "group"},
        is_system=False,
        template_key=None,
    )
    ag.set_group_memory(gid, notes="Logistique du stage.", inherit_shared=True)

    assert ag.group_uses_enterprise_science(gid) is False
    assert _scoped_brand_context(gid) == ""
    mem = _cio_prompt_memory(
        "coordinateur", exclude_job_id=None, chat_mode=False, agent_group_id=gid
    )
    assert "Logistique du stage" in mem
    assert marker in mem
    assert "Contexte global entreprise" not in mem
    assert "Historique missions Korymb" not in mem
