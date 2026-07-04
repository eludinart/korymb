"""Tests mémoire entreprise — résumé auto et directives utilisateur."""
from __future__ import annotations


def test_summarize_uses_dedicated_timestamp_not_row_updated_at(monkeypatch):
    from services import memory as mem

    calls: list[dict] = []

    def fake_merge(updates):
        calls.append(dict(updates))
        return {
            "contexts": {
                "auto_summary": updates.get("auto_summary", ""),
                "auto_summary_updated_at": updates.get("auto_summary_updated_at", ""),
            },
            "recent_missions": [],
            "updated_at": "2026-01-01T00:00:00",
        }

    monkeypatch.setattr(mem, "get_enterprise_memory", lambda: {
        "contexts": {"auto_summary": "ancien", "auto_summary_updated_at": "2020-01-01T00:00:00"},
        "recent_missions": [],
        "updated_at": "2026-07-04T12:00:00",
    })
    monkeypatch.setattr(mem, "list_jobs_prompt_digest", lambda limit=10: [
        {"id": "abc", "agent": "commercial", "mission": "Test", "result": "OK", "status": "completed"},
    ])
    monkeypatch.setattr(mem, "merge_enterprise_contexts", fake_merge)
    import llm_client

    monkeypatch.setattr(
        llm_client,
        "llm_turn",
        lambda *a, **k: ("nouveau résumé", 1, 2),
    )

    out = mem.summarize_mission_history()
    assert out == "nouveau résumé"
    assert calls and calls[0]["auto_summary"] == "nouveau résumé"
    assert "auto_summary_updated_at" in calls[0]


def test_memory_directive_remember_and_forget():
    from database import merge_enterprise_contexts, get_enterprise_memory
    from services.memory_directives import apply_user_memory_directive

    merge_enterprise_contexts({"global": ""})
    applied = apply_user_memory_directive("Mémorise : client Acme préfère le ton formel")
    assert applied and applied["action"] == "remember"
    mem = get_enterprise_memory()
    assert "Acme" in mem["contexts"]["global"]

    applied2 = apply_user_memory_directive("Oublie de la mémoire : Acme")
    assert applied2 and applied2["action"] == "forget_phrase"
    mem2 = get_enterprise_memory()
    assert "Acme" not in mem2["contexts"]["global"]
