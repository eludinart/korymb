"""Cache court du briefing. Inutile pendant les tests (ENV=test)."""
from __future__ import annotations

import copy
import os
import time
from typing import Any

_TTL_S = 45.0
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def cache_enabled() -> bool:
    return os.getenv("ENV") != "test"


def load_briefing(key: str) -> dict[str, Any] | None:
    if not cache_enabled():
        return None
    hit = _CACHE.get(key)
    if not hit:
        return None
    stored_at, body = hit
    if (time.monotonic() - stored_at) >= _TTL_S:
        _CACHE.pop(key, None)
        return None
    return copy.deepcopy(body)


def store_briefing(key: str, body: dict[str, Any]) -> None:
    if not cache_enabled():
        return
    _CACHE[key] = (time.monotonic(), copy.deepcopy(body))


def invalidate_briefing_cache() -> None:
    _CACHE.clear()
