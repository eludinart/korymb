"""Confirmation locale après une écriture projet, sans attendre un modèle vide."""
from __future__ import annotations

from agent_tool_use import _workspace_write_confirmation


def test_update_confirmation_uses_the_project_title():
    line = (
        '[outil] korymb_update_project → {   "ok": true,   "project": {     '
        '"id": "prj-b6c0829c375a",     "title": "Pizza Lucio – B2B",     "status": "active"'
    )
    assert _workspace_write_confirmation([line]) == "C'est fait. Le projet « Pizza Lucio – B2B » est à jour."


def test_chat_write_strips_a_name_only_mentioned_to_be_removed():
    from agent_tool_use import _ground_chat_write, _tool_run_ctx

    token = _tool_run_ctx.set(
        {
            "chat_mode": "1",
            "user_corpus": "retirer le nom Alexandre Martin du projet Pizza Lucio – B2B",
            "tool_evidence": "",
        }
    )
    try:
        out = _ground_chat_write(
            "korymb_update_project",
            {
                "title": "Pizza Lucio – B2B",
                "description": "Responsable du projet : Alexandre Martin. Échéance 28/11/2024.",
                "update_tasks": [{"title": "Documentation", "detail": "Contacter Docker Compose."}],
            },
        )
    finally:
        _tool_run_ctx.reset(token)
    assert "Alexandre" not in out["description"]
    assert "28/11/2024" not in out["description"]
    assert "Pizza Lucio" in out["title"]
    assert "Docker Compose" not in out["update_tasks"][0]["detail"]
    assert out["_grounding_stripped"]


def test_quotidien_reply_strips_an_invented_email():
    from services.assistant_chat import CHAT_USE_MODE_QUOTIDIEN, _maybe_seal

    _reply, surface, payload = _maybe_seal(
        "Écris à fake@example.com pour confirmer la suite du dossier.",
        "Écris à fake@example.com pour confirmer la suite du dossier.",
        message="dis bonjour",
        history=[],
        chat_use_mode=CHAT_USE_MODE_QUOTIDIEN,
        job_logs=[],
        job_id=None,
    )
    assert "fake@example.com" not in surface
    assert payload is not None
    assert payload["status"] in {"partial", "unknown"}


def test_failed_write_does_not_confirm():
    line = '[outil] korymb_update_project → { "ok": false, "error": "introuvable" }'
    assert _workspace_write_confirmation([line]) == ""
