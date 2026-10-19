"""mission_events table (dual-write with jobs.events_json).

Revision ID: 001_mission_events
Revises:
Create Date: 2026-09-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "001_mission_events"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "sqlite":
        op.execute(
            """
            CREATE TABLE IF NOT EXISTS mission_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT '',
                agent TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            )
            """
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_mission_events_job ON mission_events (workspace_id, job_id, id)"
        )
    else:
        op.execute(
            """
            CREATE TABLE IF NOT EXISTS mission_events (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                job_id VARCHAR(191) NOT NULL,
                workspace_id VARCHAR(191) NOT NULL,
                kind TEXT NOT NULL,
                agent TEXT NOT NULL,
                payload_json LONGTEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        try:
            op.execute(
                "CREATE INDEX idx_mission_events_job ON mission_events (workspace_id, job_id, id)"
            )
        except Exception:
            pass


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mission_events")
