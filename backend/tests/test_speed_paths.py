"""Budgets de lectures : briefing, courrier, index."""
from __future__ import annotations


def _count_executes(monkeypatch, module_path: str):
    import importlib

    module = importlib.import_module(module_path)
    real = module.get_conn
    sqls: list[str] = []

    class _Conn:
        def __init__(self):
            self._cm = real()
            self._inner = None

        def __enter__(self):
            self._inner = self._cm.__enter__()
            return self

        def __exit__(self, exc_type, exc, tb):
            return self._cm.__exit__(exc_type, exc, tb)

        def execute(self, sql, params=None):
            sqls.append(str(sql))
            if params is None:
                return self._inner.execute(sql)
            return self._inner.execute(sql, params)

        def commit(self):
            return self._inner.commit()

    monkeypatch.setattr(module, "get_conn", lambda: _Conn())
    return sqls


def test_hot_indexes_created(client):
    from database import get_conn

    with get_conn() as conn:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()
    names = {str(dict(row).get("name") or "") for row in rows}
    assert "idx_jobs_ws_created" in names
    assert "idx_jobs_ws_status_updated" in names
    assert "idx_email_msg_ws_thread_created" in names
    assert "idx_cal_ws_starts" in names


def test_list_mailbox_does_not_query_each_thread(client, monkeypatch):
    from services.business_db import create_contact
    from services.email_prospecting import list_mailbox, record_outbound_email

    for i in range(12):
        contact = create_contact(
            name=f"Budget {i}",
            email=f"budget-{i}@example.com",
            contact_type="prospect",
        )
        record_outbound_email(
            contact_id=contact["id"],
            to_email=f"budget-{i}@example.com",
            subject=f"Proposition {i}",
            body="Bonjour,\n\nProposition.",
        )

    sqls = _count_executes(monkeypatch, "services.email_prospecting")
    listed = list_mailbox(limit=80)
    assert len(listed["threads"]) >= 12
    assert len(sqls) <= 8, sqls
    assert not any("thread_id=?" in sql and "biz_email_messages" in sql for sql in sqls)


def test_jobs_summary_skips_events_blob_without_cio(client):
    from database import get_conn, list_jobs_summary, save_job

    save_job("nocio1", "coordinateur", "sans question", source="test")
    with get_conn() as conn:
        conn.execute(
            "UPDATE jobs SET events_json=? WHERE id=? AND workspace_id=?",
            ('[{"type":"tool_call","payload":{"tool":"x"}}]', "nocio1", "ws-default-legacy"),
        )
        conn.commit()
    rows = list_jobs_summary(limit=80)
    row = next(item for item in rows if item.get("id") == "nocio1")
    assert row["events"] == []


def test_briefing_cache_reuses_then_drops_after_job_write(client, monkeypatch):
    import services.director_platform as dp
    from database import save_job

    monkeypatch.setattr("services.briefing_cache.cache_enabled", lambda: True)
    calls = {"n": 0}
    real = dp._build_briefing_uncached

    def _wrapped(*, period: str = "today"):
        calls["n"] += 1
        return real(period=period)

    monkeypatch.setattr(dp, "_build_briefing_uncached", _wrapped)
    dp.build_briefing()
    dp.build_briefing()
    assert calls["n"] == 1
    save_job("cachebust1", "coordinateur", "invalide le cache", source="test")
    dp.build_briefing()
    assert calls["n"] == 2
