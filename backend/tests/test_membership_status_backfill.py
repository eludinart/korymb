"""Le backfill status des abonnés ne doit pas courir à chaque lecture."""
from __future__ import annotations


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _Conn:
    def __init__(self, columns: set[str]):
        self.columns = columns
        self.sql: list[str] = []

    def execute(self, sql, params=None):
        self.sql.append(sql)
        if "PRAGMA table_info" in sql:
            return _Result([(0, name, "TEXT", 0, None, 0) for name in sorted(self.columns)])
        return _Result([])


def test_status_backfill_skipped_when_column_exists():
    from workspace_db import _ensure_membership_participant_columns

    conn = _Conn({"workspace_id", "user_id", "role", "created_at", "status", "invite_code", "invited_at", "validated_at"})
    _ensure_membership_participant_columns(conn)
    assert not any(sql.startswith("UPDATE korymb_memberships") for sql in conn.sql)
    assert not any(sql.startswith("ALTER TABLE") for sql in conn.sql)


def test_status_backfill_runs_when_column_is_created():
    from workspace_db import _ensure_membership_participant_columns

    conn = _Conn({"workspace_id", "user_id", "role", "created_at"})
    _ensure_membership_participant_columns(conn)
    assert any("ADD COLUMN status" in sql for sql in conn.sql)
    assert any(sql.startswith("UPDATE korymb_memberships SET status='active'") for sql in conn.sql)
