"""Chaque appel de modèle laisse un identifiant stable dans le journal."""
from __future__ import annotations


def test_llm_trace_has_a_span_id(app):
    from database import list_mission_traces, save_job
    from llm_client import log_llm_call_financial
    from llm_usage_context import usage_llm_scope

    job_id = "job-span-p1"
    save_job(job_id, "commercial", "Journal d'un appel", source="test")
    with usage_llm_scope(job_id, "commercial:turn"):
        log_llm_call_financial(
            provider="anthropic",
            model="claude-test",
            tier="standard",
            tokens_in=10,
            tokens_out=4,
            price_input_per_million=1,
            price_output_per_million=2,
            latency_ms=12,
        )
        log_llm_call_financial(
            provider="anthropic",
            model="claude-test",
            tier="standard",
            tokens_in=3,
            tokens_out=1,
            price_input_per_million=1,
            price_output_per_million=2,
            latency_ms=5,
        )
    rows = list_mission_traces(job_id)
    assert len(rows) == 2
    spans = [str(row.get("span_id") or "") for row in rows]
    assert all(len(span) >= 8 for span in spans)
    assert spans[0] != spans[1]
    assert rows[0]["agent"] == "commercial"
    assert rows[0]["graph_node"] == "commercial:turn"
