"""Mode d'usage du chat Assistant (quotidien vs opérationnel)."""
from __future__ import annotations

from services.assistant_chat import (
    CHAT_USE_MODE_OPERATIONNEL,
    CHAT_USE_MODE_QUOTIDIEN,
    build_assistant_system_prompt,
    history_limit_for_mode,
    messages_for_assistant,
    normalize_chat_use_mode,
)


def test_normalize_chat_use_mode():
    assert normalize_chat_use_mode(None) == CHAT_USE_MODE_QUOTIDIEN
    assert normalize_chat_use_mode("operationnel") == CHAT_USE_MODE_OPERATIONNEL
    assert normalize_chat_use_mode("QUOTIDIEN") == CHAT_USE_MODE_QUOTIDIEN


def test_history_limit_quotidien_longer():
    assert history_limit_for_mode("quotidien") == 24
    assert history_limit_for_mode("operationnel") == 12


def test_messages_for_assistant_respects_limit():
    hist = [{"role": "user", "content": f"m{i}"} for i in range(30)]
    out = messages_for_assistant(hist, "now", limit=24)
    # 24 historiques + message courant
    assert len(out) == 25
    assert out[-1]["content"] == "now"
    assert out[0]["content"] == "m6"


def test_degraded_reply_is_not_replayed():
    out = messages_for_assistant(
        [
            {"role": "user", "content": "Bonjour"},
            {
                "role": "assistant",
                "content": (
                    "[[korymb-degraded]]\n**Mode dégradé** — quota. "
                    "Je ne peux pas traiter cette demande tant que le modèle est indisponible."
                ),
            },
            {
                "role": "assistant",
                "content": (
                    "Je suis désolé, mais je ne peux pas poursuivre tant que le service n'est pas disponible. "
                    "La conversation est enregistrée ; envoyez votre demande dès que le modèle sera de nouveau en ligne."
                ),
            },
        ],
        "On reprend ?",
    )
    assert [m["content"] for m in out] == ["Bonjour", "On reprend ?"]


def test_turn_needs_team_tools_on_short_confirmation():
    from services.chat_intelligence import chat_turn_needs_team_tools, strip_unbacked_team_button

    history = [
        {
            "role": "assistant",
            "content": "Clique sur le bouton « Créer l'équipe » dans ton interface.",
        }
    ]
    assert chat_turn_needs_team_tools("oui", history) is True
    assert chat_turn_needs_team_tools("crée l'équipe Cabinet", []) is True
    assert chat_turn_needs_team_tools("bonjour", history) is False
    assert chat_turn_needs_team_tools("oui", []) is False
    stripped = strip_unbacked_team_button(
        "Voici le plan.\nClique sur le bouton « Créer l'équipe ».\nL'équipe compte 3 rôles."
    )
    assert "bouton" not in stripped.lower()
    assert "3 rôles" in stripped


def test_quotidien_without_tools_forbids_fake_team_button():
    daily = build_assistant_system_prompt("bonjour", chat_use_mode="quotidien", tools_enabled=False)
    assert "n'as pas l'outil" in daily.lower() or "pas l'outil" in daily.lower()
    assert "crée l'équipe" in daily.lower()


def test_resolve_pending_blueprint_only_when_proposed(monkeypatch):
    from services.assistant_chat import resolve_pending_blueprint_id

    def fake_get(bid: str):
        if bid == "bp-aaaaaaaaaaaa":
            return {"id": bid, "status": "proposed"}
        return {"id": bid, "status": "confirmed"}

    monkeypatch.setattr("services.agent_groups.get_blueprint", fake_get)
    assert resolve_pending_blueprint_id("déjà bp-bbbbbbbbbbbb", "puis bp-aaaaaaaaaaaa") == "bp-aaaaaaaaaaaa"
    assert resolve_pending_blueprint_id("bp-bbbbbbbbbbbb") is None
    assert resolve_pending_blueprint_id(direct="bp-cccccccccccc") == "bp-cccccccccccc"


def test_quotidien_prompt_skips_lead_shape():
    ops = build_assistant_system_prompt("bonjour", chat_use_mode="operationnel")
    daily = build_assistant_system_prompt("bonjour", chat_use_mode="quotidien")
    assert "ce qui est décidé" in ops.lower() or "prochain pas" in ops.lower()
    assert "assistant quotidien" in daily.lower()
    assert "n'impose pas le format" in daily.lower() or "naturellement" in daily.lower()
