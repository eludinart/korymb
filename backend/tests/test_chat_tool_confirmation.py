"""Confirmation locale après une écriture projet, sans attendre un modèle vide."""
from __future__ import annotations

from agent_tool_use import _workspace_write_confirmation


def test_update_confirmation_uses_the_project_title():
    line = (
        '[outil] korymb_update_project → {   "ok": true,   "project": {     '
        '"id": "prj-b6c0829c375a",     "title": "Pizza Lucio – B2B",     "status": "active"'
    )
    assert _workspace_write_confirmation([line]) == "C'est fait. Le projet « Pizza Lucio – B2B » est à jour."


def test_failed_write_does_not_confirm():
    line = '[outil] korymb_update_project → { "ok": false, "error": "introuvable" }'
    assert _workspace_write_confirmation([line]) == ""
