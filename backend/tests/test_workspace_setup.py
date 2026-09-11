"""Templates de mission et playbooks créés par l'assistant."""
from __future__ import annotations

import json


def test_save_and_list_mission_template(client):
    from tools.workspace_setup import run_list_mission_templates, run_save_mission_template

    created = json.loads(
        run_save_mission_template(
            {
                "name": "SWOT activité",
                "description": "Analyse concurrentielle",
                "mission_text": "SWOT pour {{secteur}} face à {{concurrents}}.",
            }
        )
    )
    assert created["ok"] is True
    assert created["href"] == "/administration/templates"
    assert "secteur" in created["variables"]

    listed = json.loads(run_list_mission_templates())
    assert listed["ok"] is True
    assert any(t["name"] == "SWOT activité" for t in listed["templates"])

    updated = json.loads(
        run_save_mission_template(
            {
                "template_id": created["id"],
                "name": "SWOT activité",
                "mission_text": "SWOT mis à jour pour {{secteur}}.",
            }
        )
    )
    assert updated["ok"] is True
    assert updated["id"] == created["id"]


def test_save_and_list_playbook(client):
    from tools.workspace_setup import run_list_playbooks, run_save_playbook

    created = json.loads(
        run_save_playbook(
            {
                "name": "Roadmap 12 mois",
                "description": "Plan trimestriel",
                "mission": "Établir une roadmap 12 mois avec 4 trimestres pour {{initiative}}.",
                "category": "ops",
            }
        )
    )
    assert created["ok"] is True
    assert created["href"] == "/gestion/playbooks"

    listed = json.loads(run_list_playbooks())
    assert any(p["name"] == "Roadmap 12 mois" for p in listed["playbooks"])


def test_workspace_tools_exposed_for_assistant_tag(client):
    from agent_tool_use import tool_names_for_tags

    names = tool_names_for_tags(["workspace"])
    assert "korymb_save_mission_template" in names
    assert "korymb_save_playbook" in names
    assert "korymb_list_mission_templates" in names
