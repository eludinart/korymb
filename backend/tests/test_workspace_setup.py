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
    assert "korymb_create_project" in names
    assert "korymb_list_projects" in names
    assert "korymb_update_project" in names
    assert "korymb_list_mission_templates" in names


def test_create_project_writes_tasks_and_reuses_title(client):
    from services.business_db import get_project
    from tools.workspace_setup import run_create_project

    created = json.loads(
        run_create_project(
            {
                "title": "Pizza Lucio B2B",
                "description": "Commande B2B, paiement et livraison.",
                "tasks": [
                    {"title": "Architecture", "detail": "Découper front, API, paiement."},
                    {"title": "Stripe", "detail": "Encaissement."},
                    "Tests",
                ],
            }
        )
    )
    assert created["ok"] is True
    assert created["created"] is True
    assert created["href"].startswith("/gestion/projets/")
    assert len(created["tasks"]) == 3

    project = get_project(created["id"])
    assert project is not None
    assert project["status"] == "active"
    assert len(project["milestones"]) == 3
    assert set(project["linked_job_ids"]) == {t["job_id"] for t in created["tasks"]}

    from database import get_job

    job = get_job(created["tasks"][0]["job_id"])
    assert job is not None
    assert job["status"] == "planned"
    assert job["source"] == "project"
    assert "Architecture" in str(job["mission"])
    assert job["mission_config"]["project_id"] == created["id"]
    assert job["mission_config"]["task_id"]

    again = json.loads(
        run_create_project(
            {
                "title": "Pizza Lucio B2B",
                "tasks": [{"title": "Architecture"}, {"title": "CI/CD"}],
            }
        )
    )
    assert again["ok"] is True
    assert again["created"] is False
    assert again["id"] == created["id"]
    assert [t["title"] for t in again["tasks"]] == ["CI/CD"]
    refreshed = get_project(created["id"])
    assert refreshed is not None
    assert len(refreshed["milestones"]) == 4
    from services.work_tasks import list_work_tasks

    linked = [task for task in list_work_tasks() if task.get("project_id") == created["id"]]
    assert {task["title"] for task in linked} == {"Architecture", "Stripe", "Tests", "CI/CD"}
    assert sum(task["title"] == "Architecture" for task in linked) == 1


def test_update_project_renames_completes_and_removes(client):
    from database import get_job
    from services.business_db import get_project
    from tools.workspace_setup import run_create_project, run_list_projects, run_update_project

    created = json.loads(
        run_create_project(
            {
                "title": "Atelier Sivana",
                "description": "Week-end.",
                "tasks": [{"title": "Accueil"}, {"title": "Clôture"}],
            }
        )
    )
    assert created["ok"] is True
    listed = json.loads(run_list_projects())
    assert any(p["title"] == "Atelier Sivana" for p in listed["projects"])

    updated = json.loads(
        run_update_project(
            {
                "title": "Atelier Sivana",
                "new_title": "Atelier Sivana été",
                "description": "Week-end révisé.",
                "add_tasks": [{"title": "Matériel"}],
                "complete_tasks": ["Accueil"],
                "rename_tasks": [{"title": "Clôture", "new_title": "Bilan"}],
            }
        )
    )
    assert updated["ok"] is True
    assert updated["project"]["title"] == "Atelier Sivana été"
    assert updated["project"]["description"].startswith("Week-end révisé")
    labels = {t["title"]: t for t in updated["project"]["tasks"]}
    assert labels["Accueil"]["done"] is True
    assert "Bilan" in labels
    assert "Matériel" in labels
    assert "Clôture" not in labels

    accueil = get_job(labels["Accueil"]["job_id"])
    assert accueil is not None
    assert accueil["status"] == "completed"
    bilan = get_job(labels["Bilan"]["job_id"])
    assert bilan is not None
    assert str(bilan["mission"]).startswith("Bilan — Atelier Sivana été")
    assert "Contexte du projet :\nWeek-end révisé." in str(bilan["mission"])
    assert "Contexte du projet :\nWeek-end." not in str(bilan["mission"])

    removed = json.loads(
        run_update_project({"project_id": created["id"], "remove_tasks": ["Matériel"]})
    )
    assert removed["ok"] is True
    left = {t["title"] for t in removed["project"]["tasks"]}
    assert "Matériel" not in left
    assert get_job(labels["Matériel"]["job_id"]) is None
    stored = get_project(created["id"])
    assert stored is not None
    assert stored["title"] == "Atelier Sivana été"
