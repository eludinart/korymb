"""Alembic env — utilise les variables KORYMB_DB_* / FLEUR_DB_* (MariaDB) ou SQLite."""
from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool, create_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def _sqlalchemy_url() -> str:
    engine = str(os.getenv("KORYMB_DB_ENGINE", "sqlite")).strip().lower()
    if engine in {"mariadb", "mysql"}:
        host = os.getenv("KORYMB_DB_HOST") or os.getenv("FLEUR_DB_HOST") or "127.0.0.1"
        port = os.getenv("KORYMB_DB_PORT") or os.getenv("FLEUR_DB_PORT") or "3306"
        user = os.getenv("KORYMB_DB_USER") or os.getenv("FLEUR_DB_USER") or ""
        password = os.getenv("KORYMB_DB_PASSWORD") or os.getenv("FLEUR_DB_PASSWORD") or ""
        name = os.getenv("KORYMB_DB_NAME") or os.getenv("FLEUR_DB_NAME") or "korymb"
        return f"mysql+pymysql://{user}:{password}@{host}:{port}/{name}?charset=utf8mb4"
    db_path = Path(__file__).resolve().parent.parent / "data" / "korymb.db"
    return f"sqlite:///{db_path.as_posix()}"


def run_migrations_offline() -> None:
    url = _sqlalchemy_url()
    context.configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _sqlalchemy_url()
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
