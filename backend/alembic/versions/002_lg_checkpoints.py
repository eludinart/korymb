"""LangGraph progress tables in the same database as jobs.

Revision ID: 002_lg_checkpoints
Revises: 001_mission_events
Create Date: 2026-10-16
"""
from __future__ import annotations

from alembic import op

revision = "002_lg_checkpoints"
down_revision = "001_mission_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "sqlite":
        op.execute(
            """
            CREATE TABLE IF NOT EXISTS lg_checkpoints (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                parent_checkpoint_id TEXT,
                type TEXT,
                checkpoint BLOB,
                metadata BLOB,
                workspace_id TEXT NOT NULL DEFAULT 'ws-default-legacy',
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            )
            """
        )
        op.execute(
            """
            CREATE TABLE IF NOT EXISTS lg_checkpoint_writes (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                channel TEXT NOT NULL,
                type TEXT,
                value BLOB,
                workspace_id TEXT NOT NULL DEFAULT 'ws-default-legacy',
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
            )
            """
        )
    else:
        op.execute(
            """
            CREATE TABLE IF NOT EXISTS lg_checkpoints (
                thread_id VARCHAR(128) NOT NULL,
                checkpoint_ns VARCHAR(128) NOT NULL DEFAULT '',
                checkpoint_id VARCHAR(128) NOT NULL,
                parent_checkpoint_id VARCHAR(128),
                type VARCHAR(64),
                checkpoint LONGBLOB,
                metadata LONGBLOB,
                workspace_id VARCHAR(191) NOT NULL DEFAULT 'ws-default-legacy',
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            )
            """
        )
        op.execute(
            """
            CREATE TABLE IF NOT EXISTS lg_checkpoint_writes (
                thread_id VARCHAR(128) NOT NULL,
                checkpoint_ns VARCHAR(128) NOT NULL DEFAULT '',
                checkpoint_id VARCHAR(128) NOT NULL,
                task_id VARCHAR(128) NOT NULL,
                idx INTEGER NOT NULL,
                channel VARCHAR(128) NOT NULL,
                type VARCHAR(64),
                value LONGBLOB,
                workspace_id VARCHAR(191) NOT NULL DEFAULT 'ws-default-legacy',
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
            )
            """
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS lg_checkpoint_writes")
    op.execute("DROP TABLE IF EXISTS lg_checkpoints")
