"""Pertinence audit reprise — dormant, ignorés, gaps filtrés."""
from __future__ import annotations

from services.reprise_audit import (
    _format_director_reprise_decisions,
    _gaps_eligible_for_proposals,
    scan_reprise_coverage,
)


def test_blank_workspace_reprise_audit_is_empty(monkeypatch):
    monkeypatch.setattr("database.list_reprise_checklist_actions", lambda: [])
    coverage = scan_reprise_coverage({"memory_contexts": {}})
    assert coverage["workspace_empty"] is True
    assert coverage["gaps"] == []
    assert coverage["domains"] == []
    assert "tarot" not in str(coverage).lower()


def test_chat_welcome_does_not_open_reprise_audit(monkeypatch):
    monkeypatch.setattr("database.list_reprise_checklist_actions", lambda: [])
    coverage = scan_reprise_coverage({
        "memory_contexts": {},
        "recent_missions": [],
        "missions_digest": [{
            "mission": "Décide avec moi et dis-moi quoi faire ensuite.",
            "result": (
                "Je suis l'assistant Korymb, votre copilote dans le cockpit. "
                "Je suis là pour vous aider à prendre des décisions et à définir les prochaines étapes."
            ),
        }],
        "thread_excerpts": [{
            "mission": "Décide avec moi et dis-moi quoi faire ensuite.",
            "thread_tail": [{
                "role": "assistant",
                "content": "Pour commencer, quel est le sujet principal que vous souhaitez aborder ?",
            }],
        }],
    })
    assert coverage["workspace_empty"] is True
    assert coverage["gaps"] == []
    assert coverage["domains"] == []


def test_specialty_domain_stays_out_without_matching_activity(monkeypatch):
    monkeypatch.setattr("database.list_reprise_checklist_actions", lambda: [])
    coverage = scan_reprise_coverage({
        "memory_contexts": {
            "global": "Sorties en mer et découverte du littoral varois, devis pour les groupes scolaires et les familles.",
        },
    })
    assert coverage["workspace_empty"] is False
    tarot = next(d for d in coverage["domains"] if d["id"] == "editorial_tarot")
    assert tarot["status"] == "not_applicable"
    assert tarot["checklist_missing"] == []
    assert "editorial_tarot" not in {g["id"] for g in coverage["gaps"]}


def test_acquisition_domains_dormant_without_reprise_context():
    coverage = scan_reprise_coverage({"memory_contexts": {"global": "Ateliers tarot sur bateau, prospection coaches."}})
    assert coverage["has_reprise_context"] is False
    banque = next(d for d in coverage["domains"] if d["id"] == "banque_tresorerie")
    assert banque["status"] == "dormant"
    assert "dormant_reason" in banque
    gap_ids = {g["id"] for g in coverage["gaps"]}
    assert "banque_tresorerie" not in gap_ids
    assert "editorial_tarot" in gap_ids or any(d["id"] == "editorial_tarot" for d in coverage["domains"])


def test_acquisition_domains_active_with_reprise_context():
    coverage = scan_reprise_coverage({
        "memory_contexts": {"global": "Projet de reprise Élude In Art — cession en cours."},
    })
    assert coverage["has_reprise_context"] is True
    banque = next(d for d in coverage["domains"] if d["id"] == "banque_tresorerie")
    assert banque["status"] != "dormant"


def test_ignored_items_excluded_from_proposal_gaps(client):
    from database import merge_enterprise_contexts

    merge_enterprise_contexts({
        "global": "Projet de reprise — cession en cours, due diligence.",
    })
    r0 = client.get("/admin/reprise/coverage")
    domain = next(
        d for d in r0.json()["domains"]
        if d.get("checklist_missing") and d.get("status") != "dormant"
    )
    domain_id = domain["id"]
    item = domain["checklist_missing"][0]
    client.post(
        "/admin/reprise/actions",
        json={"domain_id": domain_id, "item_text": item, "action": "ignored", "note": "Pas pour maintenant"},
    )
    coverage = client.get("/admin/reprise/coverage").json()
    eligible = _gaps_eligible_for_proposals(coverage)
    for g in eligible:
        assert item not in (g.get("checklist_missing") or [])
    decisions = _format_director_reprise_decisions(list(coverage.get("user_actions", {}).values()))
    assert "ignoré" in decisions.lower() or "Ignoré" in decisions
