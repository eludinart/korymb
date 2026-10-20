"""Boot MariaDB : l'instantané de schéma évite les allers-retours du tunnel."""
from __future__ import annotations

from database import _SkippedDDL, init_sql_shortcut
from workspace_db import ensure_workspace_columns


def test_shortcut_skips_existing_create_and_serves_columns():
    snap = {
        "jobs": {
            "id": {"type": "varchar(191)", "default": None, "nullable": "NO"},
            "mission_thread_json": {"type": "longtext", "default": "[]", "nullable": "NO"},
        }
    }
    assert isinstance(
        init_sql_shortcut("CREATE TABLE IF NOT EXISTS jobs (id VARCHAR(191))", snap),
        _SkippedDDL,
    )
    shown = init_sql_shortcut("SHOW COLUMNS FROM jobs", snap)
    assert isinstance(shown, list)
    names = {row["Field"] for row in shown}
    assert names == {"id", "mission_thread_json"}
    like = init_sql_shortcut("SHOW COLUMNS FROM jobs LIKE 'mission_thread_json'", snap)
    assert isinstance(like, list)
    assert like[0]["Type"] == "longtext"
    assert like[0]["Default"] == "[]"
    assert init_sql_shortcut("SHOW COLUMNS FROM missing", snap) is None
    assert init_sql_shortcut("SELECT 1", snap) is None
    assert init_sql_shortcut("CREATE TABLE IF NOT EXISTS jobs (id INT)", None) is None
    multiline = """
            CREATE TABLE IF NOT EXISTS enterprise_memory (
                workspace_id VARCHAR(191) PRIMARY KEY
            )
            """
    assert isinstance(init_sql_shortcut(multiline, {"enterprise_memory": {"workspace_id": {}}}), _SkippedDDL)


def test_shortcut_skips_existing_index():
    import database as db

    token = db._schema_indexes.set({"idx_mission_events_job"})
    try:
        skipped = db.init_sql_shortcut(
            "CREATE INDEX IF NOT EXISTS idx_mission_events_job ON mission_events (workspace_id, job_id, id)",
            {"mission_events": {"id": {}}},
        )
        assert isinstance(skipped, _SkippedDDL)
    finally:
        db._schema_indexes.reset(token)


def test_ensure_workspace_columns_does_not_update_existing_column():
    class Rows:
        def __init__(self, rows):
            self._rows = rows

        def fetchall(self):
            return self._rows

        def fetchone(self):
            return self._rows[0] if self._rows else None

    class Conn:
        def __init__(self):
            self.sql: list[str] = []

        def execute(self, sql, params=None):
            self.sql.append(sql)
            if "PRAGMA table_info" in sql:
                return Rows([{"name": "id"}, {"name": "workspace_id"}])
            if "SELECT id FROM korymb_workspaces" in sql:
                return Rows([{"id": "ws-default-legacy"}])
            return Rows([])

    conn = Conn()
    ensure_workspace_columns(conn)
    assert not any(sql.strip().upper().startswith("UPDATE") for sql in conn.sql)
    assert not any("ADD COLUMN" in sql for sql in conn.sql)
