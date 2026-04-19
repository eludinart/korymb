"""Append-only NDJSON debug lines (session 6ec859) at repo root — used by CIO trace + tool loops."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)
_warned = False

SESSION_ID = "6ec859"
LOG_PATH = Path(__file__).resolve().parent.parent / "debug-6ec859.log"
LOG_PATH_BACKEND = Path(__file__).resolve().parent / "debug-6ec859.log"


def append_session_ndjson(
    run_id: str,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict | None = None,
) -> None:
    global _warned
    payload = {
        "sessionId": SESSION_ID,
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data or {},
        "timestamp": int(datetime.now().timestamp() * 1000),
    }
    line = json.dumps(payload, ensure_ascii=False) + "\n"
    wrote = False
    last_err: Exception | None = None
    for path in (LOG_PATH, LOG_PATH_BACKEND):
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
            wrote = True
        except Exception as e:
            last_err = e
    if not wrote and last_err is not None and not _warned:
        _warned = True
        logger.warning("append_session_ndjson: aucun chemin inscriptible (%s)", last_err)
