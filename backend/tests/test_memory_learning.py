"""Tests apprentissage auto, suppression mémoire et recommandations config."""
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


def test_delete_enterprise_context_keys(monkeypatch):
    from database import merge_enterprise_contexts, delete_enterprise_context_keys, get_enterprise_memory

    merge_enterprise_contexts({"commercial": "Client X important"})
    mem = get_enterprise_memory()
    assert "Client X" in mem["contexts"]["commercial"]

    delete_enterprise_context_keys(["commercial"])
    mem2 = get_enterprise_memory()
    assert mem2["contexts"]["commercial"] == ""


def test_learning_auto_apply_safe(monkeypatch):
    from services import learning as learn

    monkeypatch.setattr(learn, "get_learning_auto_apply_mode", lambda: "safe")
    applied: list[dict] = []

    def _apply(payload, **kw):
        applied.append(payload)
        return {"global": "ok"}

    monkeypatch.setattr(learn, "apply_learning_payload_to_memory", _apply)
    monkeypatch.setattr(
        "database.resolve_learning_suggestion",
        lambda sid, st: {"id": sid, "status": st},
    )

    payload = {
        "suggested_memory_keys": {"global": "Court fait métier"},
        "suggested_prompt_tweaks": [],
    }
    assert learn.try_auto_apply_learning("s1", payload) is True
    assert applied

    payload_tweaks = {
        "suggested_memory_keys": {"global": "x"},
        "suggested_prompt_tweaks": ["change prompt"],
    }
    assert learn.try_auto_apply_learning("s2", payload_tweaks) is False


def test_storefront_sync_auto_applies_in_safe_mode(monkeypatch):
    from services import learning as learn
    from services.memory_inbox import sync_storefront_brand_to_memory, get_enterprise_facts
    from database import merge_enterprise_contexts

    monkeypatch.setattr(learn, "get_learning_auto_apply_mode", lambda: "safe")
    merge_enterprise_contexts({"global": "Ancien contexte."})
    sug = sync_storefront_brand_to_memory(
        {
            "name": "Élude In Art",
            "slug": "eludein",
            "tagline": "Cartographie relationnelle",
            "location": "Tourves",
            "offers": [{"title": "Atelier"}],
            "intro": "Pratique ancrée.",
        }
    )
    assert sug is not None
    assert sug.get("status") == "auto_applied"
    facts = get_enterprise_facts()
    assert facts.get("brand") == "Élude In Art"
    assert "Atelier" in (facts.get("offers") or [])


def test_compact_enterprise_memory_heuristic(monkeypatch):
    from database import merge_enterprise_contexts, get_enterprise_memory
    from services.memory_inbox import compact_enterprise_memory_if_needed, MEMORY_COMPACT_TRIGGER_CHARS

    blob = ("Fait important.\n" + ("ligne répétée sur le même sujet.\n" * 400))
    assert len(blob) > MEMORY_COMPACT_TRIGGER_CHARS
    merge_enterprise_contexts({"global": blob, "memory_compacted_at": "2020-01-01T00:00:00"})
    report = compact_enterprise_memory_if_needed(force=True)
    assert report.get("compacted") is True
    mem = get_enterprise_memory()
    assert len(mem["contexts"]["global"]) < len(blob)


def test_chat_active_memory_includes_facts():
    from database import merge_enterprise_contexts
    from services.memory_inbox import merge_enterprise_facts, build_chat_active_memory_block

    merge_enterprise_contexts({"global": "Priorité : ateliers Sïvåñà."})
    merge_enterprise_facts({"brand": "Élude In Art", "location": "Tourves"})
    block = build_chat_active_memory_block()
    assert "Élude In Art" in block
    assert "ateliers" in block.lower() or "Sïvåñà" in block or "Priorité" in block


def test_propose_from_crm_creates_pending_when_auto_off(monkeypatch):
    from services import learning as learn
    from services.memory_inbox import propose_from_crm_enrichment

    monkeypatch.setattr(learn, "get_learning_auto_apply_mode", lambda: "off")
    sug = propose_from_crm_enrichment(
        contact={"id": "ctc-1", "name": "Camille", "company": "Studio Nord", "contact_type": "prospect", "city": "Aix"}
    )
    assert sug is not None
    assert sug.get("status") == "pending"
    payload = sug.get("payload") if isinstance(sug.get("payload"), dict) else {}
    assert payload.get("source") == "crm_enrichment"
    assert "commercial" in (payload.get("suggested_memory_keys") or {})


def test_config_suggestions_dedup(monkeypatch):
    from services import config_suggestions as cs

    calls: list[str] = []

    def fake_insert(**kwargs):
        calls.append(kwargs.get("target_key", ""))
        return {"id": "c1", **kwargs}

    monkeypatch.setattr(cs, "_upsert_pending", fake_insert)
    monkeypatch.setattr(
        "tools_health.probe_tools_health",
        lambda force=False: {
            "web_search": {"ok": False, "detail": "no key"},
            "checked_at": "now",
        },
    )
    monkeypatch.setattr(
        "database.count_recent_jobs_with_status_prefix",
        lambda prefix, limit=200: 0,
    )
    monkeypatch.setattr(
        "services.director_platform.emit_director_notification",
        lambda **kw: None,
    )

    out = cs.scan_config_suggestions()
    assert len(out) >= 1
    assert calls
