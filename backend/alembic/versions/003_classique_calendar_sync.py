"""Classique tasks + Google Calendar sync tables.

Revision ID: 003_classique_calendar_sync
Revises: 002_lg_checkpoints
Create Date: 2026-10-16

DDL is owned by the services (same pattern as the `_ensure_*` safety net in
init_db) so SQLite and MariaDB stay identical; this revision just runs it.
"""
from __future__ import annotations

from alembic import op

revision = "003_classique_calendar_sync"
down_revision = "002_lg_checkpoints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from services.calendar_sync import init_calendar_sync_tables
    from services.classique_bridge import init_classique_tables

    init_classique_tables()
    init_calendar_sync_tables()


def downgrade() -> None:
    for table in ("calendar_sync_runs", "calendar_sync_conflicts", "calendar_sync_links", "classique_tasks"):
        op.execute(f"DROP TABLE IF EXISTS {table}")
