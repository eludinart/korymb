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
