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


def test_assistant_tools_cover_templates_agenda_and_calendar():
    from agent_tool_use import tool_names_for_tags
    from services.agent_groups import ASSISTANT_SYSTEM
    from services.agents import ASSISTANT_TOOL_TAGS, BUILTIN_AGENT_DEFINITIONS

    names = set(tool_names_for_tags(ASSISTANT_TOOL_TAGS))
    for required in (
        "korymb_save_mission_template",
        "korymb_save_playbook",
        "gestion_upsert_contact",
        "gestion_create_quote",
        "gestion_schedule_event",
        "gestion_list_events",
        "create_calendar_event",
        "list_calendar_events",
        "korymb_overview",
    ):
        assert required in names
    assert BUILTIN_AGENT_DEFINITIONS["assistant"]["tools"] == ASSISTANT_TOOL_TAGS
    folded = ASSISTANT_SYSTEM.lower()
    assert "korymb_save_mission_template" in folded
    assert "décisions" in folded
    assert "n'écris pas de fiche" not in folded


def test_existing_fleet_only_for_deep_analysis():
    from services.chat_intelligence import message_warrants_existing_fleet, turn_offers_existing_fleet

    assert message_warrants_existing_fleet("bonjour") is False
    assert message_warrants_existing_fleet("qui es-tu ?") is False
    assert message_warrants_existing_fleet("Fais une analyse poussée de la situation commerciale.") is True
    assert message_warrants_existing_fleet("Passe ça à la flotte.") is True
    assert message_warrants_existing_fleet("oui") is False
    assert (
        turn_offers_existing_fleet(
            "oui",
            [{"role": "user", "content": "Fais un diagnostic de la situation."}],
        )
        is True
    )
    assert turn_offers_existing_fleet("oui", []) is False


def test_quotidien_prompt_lists_real_fleet_for_analysis(monkeypatch):
    monkeypatch.setattr(
        "services.agent_groups.list_groups",
        lambda include_archived=False: [
            {
                "id": "entreprise",
                "label": "Entreprise",
                "description": "Flotte métier",
                "status": "active",
                "members": [{"label": "Commercial"}],
            }
        ],
    )
    plain = build_assistant_system_prompt("bonjour", chat_use_mode="quotidien", tools_enabled=False)
    assert "analyse de flotte" not in plain.lower()
    deep = build_assistant_system_prompt(
        "Fais une analyse poussée de la situation.",
        chat_use_mode="quotidien",
        tools_enabled=False,
    )
    assert "entreprise" in deep.lower()
    assert "missions" in deep.lower()
    assert "interlocuteur" in deep.lower()
    assert "crée l'équipe" not in deep.lower()
    ops = build_assistant_system_prompt(
        "Fais une analyse poussée de la situation.",
        chat_use_mode="operationnel",
    )
    assert "analyse de flotte (ce tour)" not in ops.lower()


def test_quotidien_prompt_skips_lead_shape():
    ops = build_assistant_system_prompt("bonjour", chat_use_mode="operationnel")
    daily = build_assistant_system_prompt("bonjour", chat_use_mode="quotidien")
    assert "ce qui est décidé" in ops.lower() or "prochain pas" in ops.lower()
    assert "assistant quotidien" in daily.lower()
    assert "n'impose pas le format" in daily.lower() or "naturellement" in daily.lower()
