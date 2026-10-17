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
