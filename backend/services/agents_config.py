from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _agents_config_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "config" / "agents"


def load_agent_petals() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    base = _agents_config_dir()
    if not base.exists():
        return out
    for file_path in sorted(base.glob("*.json")):
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        key = str(data.get("key") or file_path.stem).strip()
        if not key:
            continue
        out[key] = data
    return out

