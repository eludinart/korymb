"""Normalisation des valeurs copiées vers la SQLite de dev."""
from __future__ import annotations

import importlib.util
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


def _mod():
    path = Path(__file__).resolve().parents[1] / "scripts" / "import_sqlite_dev_slice.py"
    spec = importlib.util.spec_from_file_location("import_sqlite_dev_slice", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_adapt_value_renders_sql_types():
    mod = _mod()
    assert mod.adapt_value(datetime(2026, 10, 20, 18, 0, 0)) == "2026-10-20 18:00:00"
    assert mod.adapt_value(date(2026, 10, 20)) == "2026-10-20"
    assert mod.adapt_value(Decimal("12.50")) == "12.50"
    assert mod.adapt_value({"a": 1}) == '{"a": 1}'
    assert mod.adapt_value("texte") == "texte"


def test_redact_json_secrets_clears_key_fields_only():
    mod = _mod()
    raw = '{"llm_provider": "mistral", "mistral_api_key": "secret-value", "note": "ok"}'
    out = mod.redact_json_secrets(raw)
    assert "secret-value" not in out
    assert "mistral" in out
    assert mod.redact_json_secrets("pas du json") == "pas du json"


def test_shared_columns_keeps_sqlite_order_of_maria():
    mod = _mod()
    assert mod._shared_columns(["id", "embedding", "title"], ["title", "id"]) == ["id", "title"]
