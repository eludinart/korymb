"""mission_events dual-write + chemins CIO events."""
from __future__ import annotations


def test_persist_job_events_dual_writes(client):
    from database import (
        append_mission_events_rows,
        get_conn,
        get_job,
        persist_job_events,
        save_job,
        _ws,
    )

    jid = "job-events-dual-001"
    save_job(jid, "coordinateur", "Mission dual-write test", source="test")
    from database import set_job_status_quick

    set_job_status_quick(jid, "running")
    events = [
        {"type": "cio_question", "ts": "2026-01-01T00:00:00", "payload": {"questions": ["Q1?"]}},
        {"type": "note", "ts": "2026-01-01T00:01:00", "payload": {"text": "hello"}},
    ]
    persist_job_events(jid, events)
    row = get_job(jid)
    assert row is not None
    assert len(row.get("events") or []) == 2
    with get_conn() as conn:
        n = conn.execute(
            "SELECT COUNT(*) AS c FROM mission_events WHERE job_id=? AND workspace_id=?",
            (jid, _ws()),
        ).fetchone()
    count = int(dict(n).get("c") if isinstance(n, dict) else n[0])
    assert count == 2
    # Idempotent append: second persist with same list does not duplicate.
    persist_job_events(jid, events)
    with get_conn() as conn:
        n2 = conn.execute(
            "SELECT COUNT(*) AS c FROM mission_events WHERE job_id=? AND workspace_id=?",
            (jid, _ws()),
        ).fetchone()
    count2 = int(dict(n2).get("c") if isinstance(n2, dict) else n2[0])
    assert count2 == 2
    append_mission_events_rows(jid, events)  # best-effort no-op path
    assert True


def test_mark_cio_answered_dual_writes(client):
    from database import get_conn, get_job, mark_cio_questions_answered, persist_job_events, save_job, _ws

    jid = "job-events-cio-ans-001"
    save_job(jid, "coordinateur", "CIO q", source="test")
    from database import set_job_status_quick

    set_job_status_quick(jid, "completed")
    persist_job_events(
        jid,
        [{"type": "cio_question", "ts": "t0", "payload": {"questions": ["A?"], "answered": False}}],
    )
    assert mark_cio_questions_answered(jid) is True
    row = get_job(jid)
    assert row["events"][0]["payload"]["answered"] is True
    with get_conn() as conn:
        kinds = [
            dict(r)["kind"]
            for r in conn.execute(
                "SELECT kind FROM mission_events WHERE job_id=? AND workspace_id=? ORDER BY id",
                (jid, _ws()),
            ).fetchall()
        ]
    assert "cio_question" in kinds
