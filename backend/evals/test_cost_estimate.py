"""Evals métier — estimation coût."""
from __future__ import annotations

from services.cost_estimate import estimate_mission_cost


def test_estimate_cost_tiers():
    short = estimate_mission_cost(mission="Court", agents=["coordinateur"])
    long = estimate_mission_cost(mission="x" * 5000, agents=["a", "b", "c"], mode="triad", refinement_rounds=2)
    assert short["estimated_tokens"] < long["estimated_tokens"]
    assert short["tier"] in ("economy", "standard", "research")
    assert long["estimated_cost_usd"] >= 0
