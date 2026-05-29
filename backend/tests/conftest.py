"""Fixtures pytest — backend Korymb (SQLite temporaire, secret test)."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TEST_SECRET = "korymb-test-secret-pytest"
_TMP_ROOT = Path(tempfile.mkdtemp(prefix="korymb_pytest_"))
_DB_FILE = _TMP_ROOT / "test.db"
_RUNTIME_JSON = _TMP_ROOT / "runtime_settings.json"

os.environ.setdefault("AGENT_API_SECRET", _TEST_SECRET)
os.environ.setdefault("KORYMB_DB_ENGINE", "sqlite")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("LLM_PROVIDER", "anthropic")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-test")


@pytest.fixture(scope="session")
def test_secret() -> str:
    return _TEST_SECRET


@pytest.fixture(scope="session")
def app(test_secret: str):
    import database as db_mod
    import runtime_settings as rs_mod

    db_mod.DB_PATH = _DB_FILE
    rs_mod.PATH = _RUNTIME_JSON
    if _DB_FILE.exists():
        _DB_FILE.unlink()
    if _RUNTIME_JSON.exists():
        _RUNTIME_JSON.unlink()

    from main import app as fastapi_app

    db_mod.init_db()
    return fastapi_app


@pytest.fixture
def client(app, test_secret: str):
    from fastapi.testclient import TestClient

    return TestClient(app, headers={"X-Agent-Secret": test_secret})
