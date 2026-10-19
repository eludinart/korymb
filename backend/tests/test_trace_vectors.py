"""Journal vectoriel : dimension, encodeur optionnel, SQLite sans colonne VECTOR."""
from __future__ import annotations

def test_hash_embed_is_stable_and_sized(monkeypatch):
    from services.trace_vectors import embed_excerpt, trace_vector_dimensions

    monkeypatch.setenv("KORYMB_VECTOR_DIM", "32")
    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "hash")
    assert trace_vector_dimensions() == 32
    first = embed_excerpt("Devis pour le studio")
    second = embed_excerpt("Devis pour le studio")
    assert first is not None
    assert first == second
    assert len(first) == 32
    assert abs(sum(value * value for value in first) - 1) < 0.02


def test_embed_stays_off_without_a_provider(monkeypatch):
    from services.trace_vectors import embed_excerpt, search_trace_memory, trace_memory_block

    monkeypatch.delenv("KORYMB_EMBED_PROVIDER", raising=False)
    assert embed_excerpt("bonjour") is None
    assert search_trace_memory("bonjour") == []
    assert trace_memory_block("bonjour") == ""


def test_sqlite_journal_has_no_vector_column(app):
    from database import get_conn
    from services.mission_journal import note_mission

    note_mission("job-vector-1", kind="activity", agent="assistant", excerpt="Je lis votre message")
    with get_conn() as conn:
        rows = conn.execute("PRAGMA table_info(mission_traces)").fetchall()
    names = {str(row[1]) for row in rows}
    assert "excerpt" in names
    assert "embedding" not in names


class _FakeConn:
    def __init__(self, calls, rows_by_kind):
        self.calls, self.rows_by_kind = calls, rows_by_kind

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params):
        self.calls.append((sql, params))
        key = "conversation" if "kind IN (" in sql else "journal"

        class _R:
            def fetchall(_self):
                return self.rows_by_kind[key]

        return _R()


def _patch_db(monkeypatch, ws, rows_by_kind):
    import database

    calls = []
    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "hash")
    monkeypatch.setenv("KORYMB_VECTOR_DIM", "16")
    monkeypatch.setattr(database, "_is_mariadb", lambda: True)
    monkeypatch.setattr(database, "_ws", lambda: ws)
    monkeypatch.setattr(database, "get_conn", lambda: _FakeConn(calls, rows_by_kind))
    return calls


def test_memory_block_puts_conversation_facts_first(monkeypatch):
    from services.trace_vectors import CONVERSATION_MEMORY_HEADING, trace_memory_block

    monkeypatch.delenv("CLASSIQUE_WORKSPACE_ID", raising=False)
    long_fact = "Eric a grandi au Brusc. " + "x" * 700
    calls = _patch_db(monkeypatch, "ws-eric", {
        "conversation": [{"span_id": "c1", "kind": "conversation", "excerpt": long_fact}],
        "journal": [
            {"span_id": "c1", "kind": "conversation", "excerpt": long_fact},
            {"span_id": "j1", "kind": "activity", "excerpt": "Projet Pizza Lucio"},
        ],
    })
    block = trace_memory_block("où ai-je grandi ?")
    assert block.index(CONVERSATION_MEMORY_HEADING) < block.index("Souvenirs du journal")
    assert "Eric a grandi au Brusc" in block and "Pizza Lucio" in block
    assert block.count("Eric a grandi") == 1  # dédoublonné
    fact_line = [l for l in block.splitlines() if "Brusc" in l][0]
    assert 500 < len(fact_line) <= 602
    convo_sql, convo_params = calls[0]
    assert "workspace_id IN (?,?)" in convo_sql
    assert "ws-eric" in convo_params and "ws-default-legacy" in convo_params
    journal_sql, journal_params = calls[1]
    assert "kind NOT IN (?)" in journal_sql and "ws-default-legacy" not in journal_params


def test_memory_block_falls_back_to_classique_workspace(monkeypatch):
    from services.trace_vectors import trace_memory_block

    monkeypatch.setenv("CLASSIQUE_WORKSPACE_ID", "ws-classique")
    calls = _patch_db(monkeypatch, "", {
        "conversation": [{"span_id": "c1", "kind": "conversation", "excerpt": "Bateau Tispoun"}],
        "journal": [],
    })
    block = trace_memory_block("le bateau")
    assert "Tispoun" in block and "Souvenirs du journal" not in block
    assert calls[0][0].count("?") >= 1 and "workspace_id IN (?)" in calls[0][0]
    assert "ws-classique" in calls[0][1] and "ws-classique" in calls[1][1]
