"""Checkpointer LangGraph (SQLite, aligné sur backend/data/)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from database import DB_PATH


@lru_cache(maxsize=1)
def get_checkpointer():
    from langgraph.checkpoint.sqlite import SqliteSaver

    cp_dir = DB_PATH.parent
    cp_dir.mkdir(parents=True, exist_ok=True)
    cp_file = cp_dir / "langgraph_checkpoints.db"
    conn = __import__("sqlite3").connect(str(cp_file), check_same_thread=False)
    return SqliteSaver(conn)
