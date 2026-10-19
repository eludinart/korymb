"""Mémoire des conversations : import idempotent, masquage, encodeur OpenRouter mocké."""
from __future__ import annotations

import hashlib

import pytest

KEY = "clq-test-key"


@pytest.fixture
def clq(client, monkeypatch):
    monkeypatch.setenv("CLASSIQUE_API_KEY_SHA256", hashlib.sha256(KEY.encode()).hexdigest())
    return {"Authorization": f"Bearer {KEY}"}


def _fiche(**over):
    base = {
        "external_id": "layl-2026-10-17-rag", "title": "Mémoire RAG de Korymb",
        "date": "2026-10-17", "project": "Korymb",
        "summary": "Eric veut que les échanges avec Layl nourrissent Korymb.",
        "decisions": ["Fiches courtes et datées"], "actions": ["Brancher OpenRouter"],
        "source": "appel vocal", "tags": ["rag", "memoire"],
    }
    base.update(over)
    return base


class _Resp:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._p


def test_redact_masks_tokens():
    from services.conversation_memory import redact

    text = ("clé github_pat_ABCDEFGHIJKLMNOPQRSTUV123 puis sk-or-v1-abcdef0123456789abcd "
            "et Authorization: Bearer abcdefghijklmnop1234 et AGENT_API_SECRET=supersecret123")
    out = redact(text)
    assert "github_pat_" not in out and "sk-or" not in out and "abcdefghijklmnop1234" not in out
    assert "supersecret123" not in out and "AGENT_API_SECRET=[secret masqué]" in out


def test_chunking_respects_excerpt_limit():
    from services.conversation_memory import chunk_text

    chunks = chunk_text("Phrase courte. " * 200 + "x" * 1500)
    assert len(chunks) > 1 and all(len(c) <= 700 for c in chunks)


def test_import_requires_classique_key(client, monkeypatch):
    monkeypatch.delenv("CLASSIQUE_API_KEY", raising=False)
    monkeypatch.delenv("CLASSIQUE_API_KEY_SHA256", raising=False)
    assert client.post("/classique/memory", json={"fiches": [_fiche()]}).status_code == 503
    monkeypatch.setenv("CLASSIQUE_API_KEY_SHA256", hashlib.sha256(KEY.encode()).hexdigest())
    r = client.post("/classique/memory", json={"fiches": [_fiche()]}, headers={"Authorization": "Bearer faux"})
    assert r.status_code == 401


def test_import_is_idempotent_and_redacts(client, clq, monkeypatch):
    monkeypatch.delenv("KORYMB_EMBED_PROVIDER", raising=False)
    fiche = _fiche(summary="Le jeton github_pat_ABCDEFGHIJKLMNOPQRSTUV123 ne doit pas rester.")
    r = client.post("/classique/memory", headers=clq, json={"fiches": [fiche]})
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    again = client.post("/classique/memory", headers=clq, json={"fiches": [fiche]}).json()
    assert again["skipped"] == 1 and again["created"] == 0
    changed = client.post("/classique/memory", headers=clq,
                          json={"fiches": [_fiche(summary="Résumé corrigé.")]}).json()
    assert changed["updated"] == 1

    from database import get_conn
    from services.conversation_memory import MEMORY_JOB_ID, span_prefix

    with get_conn() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT span_id, kind, agent, excerpt FROM mission_traces WHERE job_id=?", (MEMORY_JOB_ID,)
        ).fetchall()]
    assert rows and all(r["span_id"].startswith(span_prefix(fiche["external_id"])) for r in rows)
    assert all(r["kind"] == "conversation" and r["agent"] == "classique" for r in rows)
    assert all("github_pat_" not in r["excerpt"] for r in rows)
    assert any("Résumé corrigé" in r["excerpt"] for r in rows)


def test_import_rejects_oversized_payload(client, clq):
    big = [_fiche(external_id=f"f{i}", summary="x" * 7900) for i in range(80)]
    assert client.post("/classique/memory", headers=clq, json={"fiches": big}).status_code == 413
    assert client.post("/classique/memory", headers=clq, json={"fiches": []}).status_code == 422


def test_search_route_without_provider_is_empty(client, clq, monkeypatch):
    monkeypatch.delenv("KORYMB_EMBED_PROVIDER", raising=False)
    r = client.get("/classique/memory/search", params={"q": "rag"}, headers=clq)
    assert r.status_code == 200 and r.json()["results"] == []


def test_openrouter_embeddings_mocked(monkeypatch):
    from services import trace_vectors

    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "openrouter")
    monkeypatch.setenv("KORYMB_VECTOR_DIM", "8")
    monkeypatch.setenv("KORYMB_EMBED_API_KEY", "test-key")
    monkeypatch.delenv("KORYMB_EMBED_MODEL", raising=False)
    seen = {}

    def fake_post(url, json, headers, timeout):
        seen.update(url=url, body=json, headers=headers)
        return _Resp({"data": [{"index": i, "embedding": [1.0] * 12} for i in range(len(json["input"]))]})

    monkeypatch.setattr("httpx.post", fake_post)
    out = trace_vectors.embed_texts(["bonjour", "", "salut"])
    assert seen["url"] == "https://openrouter.ai/api/v1/embeddings"
    assert seen["body"]["model"] == "openai/text-embedding-3-small"
    assert seen["body"]["dimensions"] == 8 and seen["body"]["input"] == ["bonjour", "salut"]
    assert seen["headers"]["Authorization"] == "Bearer test-key"
    assert out[1] is None and len(out[0]) == 8 and abs(sum(v * v for v in out[0]) - 1) < 1e-4


def test_openrouter_falls_back_to_openrouter_key(monkeypatch):
    from services import trace_vectors

    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "openrouter")
    monkeypatch.delenv("KORYMB_EMBED_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-key")
    assert trace_vectors.embed_config()["api_key"] == "or-key"


def test_api_failure_never_raises(monkeypatch):
    from services import trace_vectors

    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "openrouter")
    monkeypatch.setenv("KORYMB_EMBED_API_KEY", "test-key")

    def boom(*a, **k):
        return _Resp({"error": "no credits"}, status=402)

    monkeypatch.setattr("httpx.post", boom)
    assert trace_vectors.embed_excerpt("bonjour") is None
    assert trace_vectors.search_trace_memory("bonjour") == []
    assert trace_vectors.trace_memory_block("bonjour") == ""


def test_openai_compatible_base_url(monkeypatch):
    from services import trace_vectors

    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "openai")
    monkeypatch.setenv("KORYMB_EMBED_BASE_URL", "http://embed.local/v1/")
    monkeypatch.setenv("KORYMB_EMBED_API_KEY", "k")
    monkeypatch.setenv("KORYMB_EMBED_MODEL", "nomic-embed-text")
    monkeypatch.setenv("KORYMB_VECTOR_DIM", "8")
    seen = {}

    def fake_post(url, json, headers, timeout):
        seen["url"] = url
        return _Resp({"data": [{"index": 0, "embedding": [0.5] * 8}]})

    monkeypatch.setattr("httpx.post", fake_post)
    assert trace_vectors.embed_excerpt("x") is not None
    assert seen["url"] == "http://embed.local/v1/embeddings"


def test_reembed_requires_mariadb(client, clq, monkeypatch):
    monkeypatch.setenv("KORYMB_EMBED_PROVIDER", "hash")
    r = client.post("/classique/memory/reembed", headers=clq, json={"only_conversations": True})
    assert r.status_code == 200 and r.json()["reason"] == "mariadb_requis"
