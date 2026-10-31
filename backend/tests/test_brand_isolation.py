"""Un espace sans contexte, ou un espace vierge, ne reçoit pas le pack Élude."""
from __future__ import annotations

from agent_tool_use import tool_names_for_tags
from services.workspace_brand import build_workspace_brand_context, is_legacy_elude_workspace
from tenant_context import clear_tenant_context, set_tenant_context
from workspace_db import ws_id


def test_missing_tenant_does_not_expose_elude_brand(client):
    clear_tenant_context()
    assert ws_id() == ""
    assert is_legacy_elude_workspace() is False
    brand = build_workspace_brand_context().lower()
    assert "fleur" not in brand
    assert "elude" not in brand
    assert "sivana" not in brand
    assert "tarot" not in brand
    names = tool_names_for_tags(["db", "web", "gestion"])
    assert "db_query" not in names
    assert "db_list_tables" not in names
    assert "gestion_upsert_contact" in names


def test_other_workspace_hides_product_database(client):
    set_tenant_context(workspace_id="ws-blank-example")
    assert is_legacy_elude_workspace() is False
    names = tool_names_for_tags(["db"])
    assert names == []
    brand = build_workspace_brand_context().lower()
    assert "fleur" not in brand
    assert "tarot" not in brand


def test_legacy_workspace_keeps_product_database(client):
    set_tenant_context(workspace_id="ws-default-legacy")
    assert is_legacy_elude_workspace() is True
    names = tool_names_for_tags(["db"])
    assert "db_query" in names


def test_client_workspace_skips_repo_proposal_files(client, tmp_path, monkeypatch):
    """Les *.proposal.tsx du monorepo ne doivent pas fuir dans un espace client."""
    from services import memory as memory_svc

    leak = tmp_path / "admin" / "elude-secret.proposal.tsx"
    leak.parent.mkdir(parents=True)
    leak.write_text("// Élude In Art tarot Fleur secret proposal\n", encoding="utf-8")
    monkeypatch.setattr(memory_svc, "_repo_root", lambda: tmp_path)
    set_tenant_context(workspace_id="ws-blank-example")
    assert memory_svc._collect_proposals(limit=8) == []
    snap = memory_svc.read_active_memory(proposal_limit=8, digest_limit=1)
    assert snap.proposals == []
    set_tenant_context(workspace_id="ws-default-legacy")
    legacy = memory_svc._collect_proposals(limit=8)
    assert len(legacy) == 1
    assert "elude-secret.proposal.tsx" in legacy[0]["path"]


def test_quotidien_prompt_uses_workspace_brand_not_eric_classique(client, monkeypatch):
    """Discussion client : identité du workspace, pas la mémoire Classique d'Éric."""
    from services.assistant_chat import build_assistant_system_prompt

    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "")
    set_tenant_context(workspace_id="ws-blank-example")
    monkeypatch.setattr(
        "services.workspace_brand._workspace_label",
        lambda _wid: "mer et découverte 83",
    )
    monkeypatch.setattr(
        "services.workspace_brand._memory_global_context",
        lambda: "Sorties en mer et découverte du littoral varois.",
    )
    daily = build_assistant_system_prompt(
        "parle moi de mon entreprise",
        chat_use_mode="quotidien",
        tools_enabled=False,
    )
    folded = daily.lower()
    assert "mer et découverte 83" in folded
    assert "littoral varois" in folded
    assert "ce que tu sais d'eric" not in folded
    assert "fleur d" not in folded
    assert "tarot" not in folded
