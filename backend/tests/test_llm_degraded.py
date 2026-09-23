import httpx

from services.chat_surface import surface_chat_result
from services.llm_degraded import (
    DEGRADED_MARKER,
    degraded_chat_reply,
    llm_outage_is_hard,
    llm_outage_kind,
    llm_outage_reason,
)


def test_outage_kind_quota_timeout_upstream():
    assert llm_outage_kind(RuntimeError("Le fournisseur LLM a répondu HTTP 402. insufficient balance")) == "quota"
    assert llm_outage_kind(RuntimeError("invalid api key")) == "quota"
    assert llm_outage_kind(httpx.ReadTimeout("timed out")) == "timeout"
    assert llm_outage_kind(RuntimeError("Le fournisseur LLM a répondu HTTP 500. upstream")) == "upstream"
    assert llm_outage_kind(RuntimeError("bug de parsing JSON")) is None
    assert llm_outage_is_hard("quota") is True
    assert llm_outage_is_hard("timeout") is False


def test_degraded_reply_answers_identity_and_keeps_marker():
    text = degraded_chat_reply("qui est tu ?", agent_label="CIO — Orchestrateur", reason=llm_outage_reason(RuntimeError("HTTP 402")))
    assert DEGRADED_MARKER in text
    assert "Mode dégradé" in text
    assert "CIO — Orchestrateur" in text
    assert "crédit" in text.lower() or "quota" in text.lower() or "clé" in text.lower()
    surfaced = surface_chat_result(text)
    assert DEGRADED_MARKER in surfaced
    assert "CIO — Orchestrateur" in surfaced


def test_chat_quota_returns_degraded_without_starting_mission(client, monkeypatch):
    monkeypatch.setattr(
        "routers.core_chat.generate_mirror_ack_result",
        lambda *a, **k: ("", RuntimeError("Le fournisseur LLM a répondu HTTP 402. insufficient balance")),
    )

    def _should_not_run(*_a, **_k):
        raise AssertionError("la mission ne doit pas démarrer si le crédit est épuisé")

    monkeypatch.setattr("routers.core_chat.orchestrate_coordinateur_mission", _should_not_run)
    res = client.post("/chat", json={"message": "qui est tu ?", "agent": "coordinateur"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("degraded") is True
    assert body.get("status") != "accepted"
    assert "Mode dégradé" in body.get("response", "")
    assert "CIO" in body.get("response", "")


def test_chat_mirror_timeout_still_accepts_job(client, monkeypatch):
    monkeypatch.setattr(
        "routers.core_chat.generate_mirror_ack_result",
        lambda *a, **k: ("Je prends en compte votre demande.", TimeoutError("timed out")),
    )
    monkeypatch.setattr(
        "routers.core_chat.orchestrate_coordinateur_mission",
        lambda *a, **k: ("Réponse normale.", 1, 1),
    )
    res = client.post("/chat", json={"message": "bonjour", "agent": "coordinateur"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("status") == "accepted"
    assert body.get("degraded") is not True
    assert body.get("job_id")


def test_degraded_reply_echoes_other_questions():
    text = degraded_chat_reply("Prépare le brief commercial de mardi.", reason="Le modèle n'a pas répondu à temps.")
    assert "brief commercial" in text
    assert "Mode dégradé" in text
    assert "temps" in text
