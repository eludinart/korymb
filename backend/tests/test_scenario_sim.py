"""Tests simulation scénarios multi-horizons (Mode Cerveau P4)."""
from __future__ import annotations


def test_heuristic_scenarios_shape():
    from services.scenario_sim import _heuristic_scenarios, simulate_decision_scenarios

    h = _heuristic_scenarios("Accepter un poste à Berlin")
    assert h["source"] == "heuristic"
    assert len(h["horizons"]) == 3
    assert {x["id"] for x in h["horizons"]} == {"1_an", "5_ans", "10_ans"}
    for hz in h["horizons"]:
        assert hz["narrative"]
        assert hz["label"]


def test_simulate_rejects_short_question():
    from services.scenario_sim import simulate_decision_scenarios
    import pytest

    with pytest.raises(ValueError):
        simulate_decision_scenarios("court")


def test_simulate_falls_back_without_llm(monkeypatch):
    from services import scenario_sim as ss

    def boom(*a, **k):
        raise RuntimeError("no llm")

    monkeypatch.setattr("llm_client.llm_turn", boom)
    out = ss.simulate_decision_scenarios("Si je change de modèle économique demain ?")
    assert out["source"] == "heuristic"
    assert len(out["horizons"]) == 3


def test_admin_scenarios_simulate_endpoint(client, monkeypatch):
    from services import scenario_sim as ss

    monkeypatch.setattr(
        ss,
        "simulate_decision_scenarios",
        lambda q, context="", thinking_mode="auto": {
            "question": q,
            "summary": "ok",
            "horizons": [
                {"id": "1_an", "label": "1 an", "narrative": "n1", "opportunities": [], "risks": [], "probability_hint": "plausible"},
                {"id": "5_ans", "label": "5 ans", "narrative": "n5", "opportunities": [], "risks": [], "probability_hint": "incertain"},
                {"id": "10_ans", "label": "10 ans", "narrative": "n10", "opportunities": [], "risks": [], "probability_hint": "spéculatif"},
            ],
            "source": "heuristic",
            "thinking_mode": thinking_mode,
        },
    )
    r = client.post(
        "/admin/scenarios/simulate",
        json={"question": "Si je lance une offre freemium ?"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == "ok"
    assert len(body["horizons"]) == 3
