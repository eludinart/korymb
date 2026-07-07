"""Tests outils agents gestion_* (CRM Korymb intégré)."""
from __future__ import annotations

import json

from tools.registry_business import dispatch_business_tool


def test_gestion_upsert_and_search(client):
    out = dispatch_business_tool(
        "gestion_upsert_contact",
        {
            "name": "Coach Test Agent",
            "email": "coach.agent@example.com",
            "company": "Cabinet Var",
            "tags": ["coach", "prospect"],
            "profile_notes": "Trouvé via LinkedIn — intéressé par Fleur d'ÅmÔurs.",
            "agent_key": "commercial",
            "job_id": "jobtest01",
        },
    )
    assert out is not None
    data = json.loads(out)
    assert data["contact"]["name"] == "Coach Test Agent"
    assert data["created"] is True

    search = dispatch_business_tool("gestion_search_contacts", {"query": "Coach Test"})
    assert search is not None
    found = json.loads(search)["contacts"]
    assert any(c["email"] == "coach.agent@example.com" for c in found)


def test_gestion_quote_and_interaction(client):
    upsert = json.loads(
        dispatch_business_tool(
            "gestion_upsert_contact",
            {"name": "Client Devis", "email": "devis.agent@example.com"},
        )
        or "{}"
    )
    cid = upsert["contact"]["id"]

    quote_out = dispatch_business_tool(
        "gestion_create_quote",
        {
            "title": "Module Pro test",
            "contact_id": cid,
            "lines_json": json.dumps(
                [{"label": "Formation 2j", "qty": 1, "unit_price_cents": 120000, "tax_rate": 0}]
            ),
            "agent_key": "comptable",
        },
    )
    assert quote_out is not None
    quote = json.loads(quote_out)["quote"]
    assert quote["total_cents"] == 120000

    interactions = dispatch_business_tool("gestion_list_interactions", {"contact_id": cid})
    assert interactions is not None
    rows = json.loads(interactions)["interactions"]
    assert len(rows) >= 1


def test_gestion_tools_registered_for_commercial():
    from agent_tool_use import tool_names_for_tags

    names = tool_names_for_tags(["gestion"])
    assert "gestion_upsert_contact" in names
    assert "gestion_create_quote" in names


def test_gestion_tool_injects_mission_context():
    from agent_tool_use import _activate_tool_run_ctx, _execute_tool, _tool_run_ctx

    token = _activate_tool_run_ctx("job-ctx-01", "subagent:commercial", "commercial")
    try:
        out = _execute_tool(
            "gestion_upsert_contact",
            {
                "name": "Context Agent",
                "email": "context.agent@example.com",
                "profile_notes": "Test injection contexte mission.",
            },
        )
    finally:
        _tool_run_ctx.reset(token)
    assert out is not None
    data = json.loads(out)
    assert data["contact"]["email"] == "context.agent@example.com"

    listed = json.loads(
        _execute_tool("gestion_list_interactions", {"contact_id": data["contact"]["id"]}) or "{}"
    )
    rows = listed.get("interactions") or []
    assert any(r.get("job_id") == "job-ctx-01" and r.get("agent_key") == "commercial" for r in rows)
