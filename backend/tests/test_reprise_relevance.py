"""Pertinence audit reprise — dormant, ignorés, gaps filtrés."""
from __future__ import annotations

from services.reprise_audit import (
    _format_director_reprise_decisions,
    _gaps_eligible_for_proposals,
    scan_reprise_coverage,
)


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
