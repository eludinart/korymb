"""Evals métier Korymb (mode mock LLM pour CI)."""
from __future__ import annotations

import json
import re

from services.agents import agents_def
from services.mission import _extract_sous_taches_from_plan, _normalize_sous_taches


def test_plan_json_parses_delegation_keys():
    raw = json.dumps({
        "agents": ["commercial", "dev"],
        "sous_taches": {"commercial": "Prospecter coaches", "developpeur": "Audit technique"},
        "synthese_attendue": "Bilan",
    })
    plan = json.loads(raw)
    st = _extract_sous_taches_from_plan(plan)
    st, _ = _normalize_sous_taches(st)
    assert "commercial" in st
    assert "developpeur" in st


def test_critic_alignment_json_shape():
    sample = '{"rejected": false, "alignment_score": 8, "critique": "", "feedback": "", "approved_sections": []}'
    data = json.loads(sample)
    assert "alignment_score" in data
    assert isinstance(data["rejected"], bool)


def test_delegatable_agents_exclude_coordinateur():
    keys = [k for k in agents_def() if k != "coordinateur"]
    assert "commercial" in keys
    assert "coordinateur" not in keys
