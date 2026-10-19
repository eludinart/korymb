"""Progression LangGraph dans la même base que les missions.

Chaque lecture ou écriture emprunte une connexion puis la rend.
Rien n'est gardé en mémoire d'un appel à l'autre : deux processus
voient le même fil (le numéro de mission).
"""
from __future__ import annotations

import json
import random
import re
import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    WRITES_IDX_MAP,
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    get_checkpoint_id,
    get_checkpoint_metadata,
)

_FILTER_KEY = re.compile(r"^[a-zA-Z0-9_.-]+$")
_tables_ready = False
_tables_lock = threading.Lock()


def get_checkpointer() -> "KorymbSaver":
    return KorymbSaver()


def _ensure_tables() -> None:
    global _tables_ready
    if _tables_ready:
        return
    with _tables_lock:
        if _tables_ready:
            return
        from database import ensure_lg_checkpoint_tables

        ensure_lg_checkpoint_tables()
        _tables_ready = True


def _workspace_id() -> str:
    wid = ""
    try:
        from tenant_context import get_workspace_id

        wid = (get_workspace_id() or "").strip()
    except Exception:
        wid = ""
    if not wid:
        from workspace_db import _DEFAULT_WORKSPACE_ID

        wid = _DEFAULT_WORKSPACE_ID
    return wid[:191]


def _as_bytes(value: Any) -> bytes | None:
    if value is None:
        return None
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        return value.encode("utf-8")
    return bytes(value)


def _loads_json_blob(raw: Any) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, memoryview):
        raw = raw.tobytes()
    if isinstance(raw, bytearray):
        raw = bytes(raw)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    text = str(raw).strip()
    if not text:
        return {}
    loaded = json.loads(text)
    return loaded if isinstance(loaded, dict) else {}


def _row(row: Any) -> dict:
    if isinstance(row, dict):
        return row
    return dict(row)


@contextmanager
def _borrow():
    from database import _is_mariadb, get_conn

    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        if _is_mariadb():
            conn.__exit__(None, None, None)
        else:
            try:
                conn.close()
            except Exception:
                pass


def _search_where(
    config: RunnableConfig | None,
    metadata_filter: dict[str, Any] | None,
    before: RunnableConfig | None,
) -> tuple[str, list[Any]]:
    from database import _is_mariadb

    clauses: list[str] = []
    params: list[Any] = []
    if config is not None:
        clauses.append("thread_id = ?")
        params.append(str(config["configurable"]["thread_id"]))
        checkpoint_ns = config["configurable"].get("checkpoint_ns")
        if checkpoint_ns is not None:
            clauses.append("checkpoint_ns = ?")
            params.append(checkpoint_ns)
        if checkpoint_id := get_checkpoint_id(config):
            clauses.append("checkpoint_id = ?")
            params.append(checkpoint_id)
    if metadata_filter:
        maria = _is_mariadb()
        for key, value in metadata_filter.items():
            if not _FILTER_KEY.match(str(key)):
                raise ValueError(f"Filtre de checkpoint invalide: {key}")
            if maria:
                clauses.append(
                    f"JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata AS CHAR), '$.{key}')) = ?"
                )
                if isinstance(value, bool):
                    params.append("true" if value else "false")
                elif value is None:
                    params.append("")
                else:
                    params.append(value)
            elif value is None:
                clauses.append(f"json_extract(CAST(metadata AS TEXT), '$.{key}') IS ?")
                params.append(None)
            elif isinstance(value, bool):
                clauses.append(f"json_extract(CAST(metadata AS TEXT), '$.{key}') = ?")
                params.append(1 if value else 0)
            elif isinstance(value, (dict, list)):
                clauses.append(f"json_extract(CAST(metadata AS TEXT), '$.{key}') = ?")
                params.append(json.dumps(value, separators=(",", ":")))
            else:
                clauses.append(f"json_extract(CAST(metadata AS TEXT), '$.{key}') = ?")
                params.append(value)
    if before is not None:
        clauses.append("checkpoint_id < ?")
        params.append(get_checkpoint_id(before))
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


class KorymbSaver(BaseCheckpointSaver[str]):
    """Checkpointer sans connexion à lui : la base des missions fait foi."""

    def get_next_version(self, current: str | None, channel: None) -> str:
        if current is None:
            current_v = 0
        elif isinstance(current, int):
            current_v = current
        else:
            current_v = int(str(current).split(".")[0])
        return f"{current_v + 1:032}.{random.random():016}"

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        _ensure_tables()
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        thread_id = str(config["configurable"]["thread_id"])
        checkpoint_id = get_checkpoint_id(config)
        with _borrow() as conn:
            if checkpoint_id:
                row = conn.execute(
                    "SELECT thread_id, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata "
                    "FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?",
                    (thread_id, checkpoint_ns, checkpoint_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT thread_id, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata "
                    "FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? "
                    "ORDER BY checkpoint_id DESC LIMIT 1",
                    (thread_id, checkpoint_ns),
                ).fetchone()
            if not row:
                return None
            found = _row(row)
            if not checkpoint_id:
                config = {
                    "configurable": {
                        "thread_id": found["thread_id"],
                        "checkpoint_ns": checkpoint_ns,
                        "checkpoint_id": found["checkpoint_id"],
                    }
                }
            writes = conn.execute(
                "SELECT task_id, channel, type, value FROM lg_checkpoint_writes "
                "WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? "
                "ORDER BY task_id, idx",
                (
                    str(config["configurable"]["thread_id"]),
                    checkpoint_ns,
                    str(config["configurable"]["checkpoint_id"]),
                ),
            ).fetchall()
        parent_id = found["parent_checkpoint_id"]
        return CheckpointTuple(
            config,
            self.serde.loads_typed((found["type"], _as_bytes(found["checkpoint"]))),
            _loads_json_blob(found["metadata"]),
            (
                {
                    "configurable": {
                        "thread_id": found["thread_id"],
                        "checkpoint_ns": checkpoint_ns,
                        "checkpoint_id": parent_id,
                    }
                }
                if parent_id
                else None
            ),
            [
                (
                    _row(item)["task_id"],
                    _row(item)["channel"],
                    self.serde.loads_typed((_row(item)["type"], _as_bytes(_row(item)["value"]))),
                )
                for item in writes or []
            ],
        )

    def list(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        _ensure_tables()
        where, params = _search_where(config, filter, before)
        query = (
            "SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata "
            f"FROM lg_checkpoints {where} ORDER BY checkpoint_id DESC"
        )
        if limit is not None:
            query += " LIMIT ?"
            params = [*params, int(limit)]
        with _borrow() as conn:
            rows = conn.execute(query, params).fetchall() or []
            pending: list[tuple[dict, list]] = []
            for raw in rows:
                item = _row(raw)
                write_rows = conn.execute(
                    "SELECT task_id, channel, type, value FROM lg_checkpoint_writes "
                    "WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? "
                    "ORDER BY task_id, idx",
                    (item["thread_id"], item["checkpoint_ns"], item["checkpoint_id"]),
                ).fetchall()
                pending.append((item, list(write_rows or [])))
        for item, write_rows in pending:
            parent_id = item["parent_checkpoint_id"]
            yield CheckpointTuple(
                {
                    "configurable": {
                        "thread_id": item["thread_id"],
                        "checkpoint_ns": item["checkpoint_ns"],
                        "checkpoint_id": item["checkpoint_id"],
                    }
                },
                self.serde.loads_typed((item["type"], _as_bytes(item["checkpoint"]))),
                _loads_json_blob(item["metadata"]),
                (
                    {
                        "configurable": {
                            "thread_id": item["thread_id"],
                            "checkpoint_ns": item["checkpoint_ns"],
                            "checkpoint_id": parent_id,
                        }
                    }
                    if parent_id
                    else None
                ),
                [
                    (
                        _row(w)["task_id"],
                        _row(w)["channel"],
                        self.serde.loads_typed((_row(w)["type"], _as_bytes(_row(w)["value"]))),
                    )
                    for w in write_rows
                ],
            )

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        _ensure_tables()
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"]["checkpoint_ns"]
        type_, serialized_checkpoint = self.serde.dumps_typed(checkpoint)
        serialized_metadata = json.dumps(
            get_checkpoint_metadata(config, metadata), ensure_ascii=False
        ).encode("utf-8", "ignore")
        with _borrow() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO lg_checkpoints ("
                "thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, workspace_id"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(thread_id),
                    checkpoint_ns,
                    checkpoint["id"],
                    config["configurable"].get("checkpoint_id"),
                    type_,
                    serialized_checkpoint,
                    serialized_metadata,
                    _workspace_id(),
                ),
            )
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint["id"],
            }
        }

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        _ensure_tables()
        query = (
            "INSERT OR REPLACE INTO lg_checkpoint_writes ("
            "thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value, workspace_id"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            if all(w[0] in WRITES_IDX_MAP for w in writes)
            else "INSERT OR IGNORE INTO lg_checkpoint_writes ("
            "thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value, workspace_id"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        wid = _workspace_id()
        with _borrow() as conn:
            for idx, (channel, value) in enumerate(writes):
                type_, blob = self.serde.dumps_typed(value)
                conn.execute(
                    query,
                    (
                        str(config["configurable"]["thread_id"]),
                        str(config["configurable"]["checkpoint_ns"]),
                        str(config["configurable"]["checkpoint_id"]),
                        task_id,
                        WRITES_IDX_MAP.get(channel, idx),
                        channel,
                        type_,
                        blob,
                        wid,
                    ),
                )

    def delete_thread(self, thread_id: str) -> None:
        _ensure_tables()
        with _borrow() as conn:
            conn.execute("DELETE FROM lg_checkpoints WHERE thread_id = ?", (str(thread_id),))
            conn.execute("DELETE FROM lg_checkpoint_writes WHERE thread_id = ?", (str(thread_id),))
