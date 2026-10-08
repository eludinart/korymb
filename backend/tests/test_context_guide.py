"""Guide de contexte : question neutre, confirmation, reprise."""
from __future__ import annotations

import uuid

from database import get_enterprise_memory, merge_enterprise_contexts
from services.context_guide import OPENING_QUESTION
from services.knowledge import get_entity
from tenant_context import set_tenant_context


def _workspace(client) -> dict:
    email = f"guide-{uuid.uuid4().hex[:10]}@example.com"
    reg = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "secretpass123",
            "workspace_name": "Guide contexte",
            "starter_pack_id": "blank",
        },
    )
    assert reg.status_code == 200, reg.text
    body = reg.json()
    return {
        "headers": {"Authorization": f"Bearer {body['token']}"},
        "workspace_id": body["workspace"]["id"],
    }


def _llm(monkeypatch, responses: list[dict | None]):
    queue = list(responses)

    def fake(system, user, **kwargs):
        if not queue:
            return None
        return queue.pop(0)

    monkeypatch.setattr("services.context_guide._llm_json", fake)
    return fake


def test_opening_question_is_neutral(client):
    ws = _workspace(client)
    res = client.get("/context-guide", headers=ws["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["phase"] == "ask"
    assert body["question"] == OPENING_QUESTION
    assert body["started"] is False
    assert body["pending"] is None
    assert "accompagn" not in body["question"].lower()
    assert body["offers_mode"] == "standards"
    assert body["view"] == "list"
    assert [item["id"] for item in body["offers"]] == [
        "standard-chiffres",
        "standard-personnes",
        "standard-offre",
    ]


def test_short_answer_does_not_write(client, monkeypatch):
    ws = _workspace(client)
    _llm(monkeypatch, [])
    res = client.post("/context-guide/answer", headers=ws["headers"], json={"answer": "oui"})
    assert res.status_code == 200, res.text
    assert res.json()["phase"] == "ask"
    assert res.json()["question"] != OPENING_QUESTION
    set_tenant_context(workspace_id=ws["workspace_id"])
    assert not str(get_enterprise_memory()["contexts"].get("global") or "").strip()


def test_vague_answer_asks_again_without_writing(client, monkeypatch):
    ws = _workspace(client)
    _llm(
        monkeypatch,
        [
            {
                "vague": True,
                "clarification": "Vous parlez de devis. Qu'est-ce qui bloque ?",
                "summary": "",
            }
        ],
    )
    res = client.post(
        "/context-guide/answer",
        headers=ws["headers"],
        json={"answer": "on a du retard sur les devis"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["phase"] == "ask"
    assert "bloque" in body["question"]
    set_tenant_context(workspace_id=ws["workspace_id"])
    assert not str(get_enterprise_memory()["contexts"].get("global") or "").strip()


def test_confirm_writes_memory_facts_and_entity(client, monkeypatch):
    ws = _workspace(client)
    summary = "Atelier Nord fabrique des meubles sur mesure pour des architectes, à Lille."
    _llm(
        monkeypatch,
        [
            {
                "vague": False,
                "summary": summary,
                "memory": {"global": summary},
                "facts": {"brand": "Atelier Nord", "location": "Lille"},
                "entities": [
                    {
                        "name": "Léa",
                        "entity_type": "person",
                        "attributes": {"role": "commandes"},
                        "relations": {"travaille pour": ["Atelier Nord"]},
                    }
                ],
            },
            {"ask": True, "question": "Qui chiffre les devis, vous ou Léa ?"},
        ],
    )
    proposed = client.post(
        "/context-guide/answer",
        headers=ws["headers"],
        json={"answer": "Atelier Nord, meubles sur mesure pour des architectes à Lille. Léa gère les commandes."},
    )
    assert proposed.status_code == 200, proposed.text
    assert proposed.json()["phase"] == "confirm"
    assert proposed.json()["pending"]["summary"] == summary
    set_tenant_context(workspace_id=ws["workspace_id"])
    assert not str(get_enterprise_memory()["contexts"].get("global") or "").strip()

    saved = client.post("/context-guide/confirm", headers=ws["headers"])
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["phase"] == "ask"
    assert "Léa" in body["question"]
    assert body["started"] is True
    assert body["turns"][0]["recorded"] == summary
    set_tenant_context(workspace_id=ws["workspace_id"])
    global_text = str(get_enterprise_memory()["contexts"].get("global") or "")
    assert summary in global_text
    from services.memory_inbox import get_enterprise_facts

    facts = get_enterprise_facts()
    assert facts.get("brand") == "Atelier Nord"
    entity = get_entity("Léa")
    assert entity is not None
    assert entity["entity_type"] == "person"
    assert "Atelier Nord" in entity["relations"].get("travaille pour", [])


def test_revise_discards_proposal(client, monkeypatch):
    ws = _workspace(client)
    _llm(
        monkeypatch,
        [
            {
                "vague": False,
                "summary": "Une phrase à ne pas garder.",
                "memory": {"global": "Une phrase à ne pas garder."},
            }
        ],
    )
    client.post(
        "/context-guide/answer",
        headers=ws["headers"],
        json={"answer": "Une phrase assez longue pour être proposée."},
    )
    revised = client.post("/context-guide/revise", headers=ws["headers"])
    assert revised.status_code == 200, revised.text
    assert revised.json()["phase"] == "ask"
    assert revised.json()["pending"] is None
    set_tenant_context(workspace_id=ws["workspace_id"])
    assert "ne pas garder" not in str(get_enterprise_memory()["contexts"].get("global") or "")


def test_second_confirm_does_not_duplicate(client, monkeypatch):
    ws = _workspace(client)
    summary = "Cabinet Sève accompagne des dirigeants, à Nantes."
    _llm(
        monkeypatch,
        [
            {"vague": False, "summary": summary, "memory": {"global": summary}},
            {"ask": True, "question": "Pour qui exactement ?"},
            {"vague": False, "summary": summary, "memory": {"global": summary}},
            {"ask": False, "question": ""},
        ],
    )
    answer = "Cabinet Sève accompagne des dirigeants à Nantes, en séance."
    assert client.post("/context-guide/answer", headers=ws["headers"], json={"answer": answer}).status_code == 200
    assert client.post("/context-guide/confirm", headers=ws["headers"]).status_code == 200
    assert client.post("/context-guide/answer", headers=ws["headers"], json={"answer": answer}).status_code == 200
    second = client.post("/context-guide/confirm", headers=ws["headers"])
    assert second.status_code == 200, second.text
    assert second.json()["phase"] == "hold"
    set_tenant_context(workspace_id=ws["workspace_id"])
    text = str(get_enterprise_memory()["contexts"].get("global") or "")
    assert text.count(summary) == 1


def test_refresh_before_any_turn_stays_neutral(client, monkeypatch):
    ws = _workspace(client)

    def fail(system, user, **kwargs):
        raise AssertionError("le modèle ne doit pas être appelé avant la première réponse")

    monkeypatch.setattr("services.context_guide._llm_json", fail)
    res = client.post("/context-guide/refresh", headers=ws["headers"])
    assert res.status_code == 200, res.text
    assert res.json()["question"] == OPENING_QUESTION


def test_return_visit_sees_context_learned_elsewhere(client, monkeypatch):
    ws = _workspace(client)
    summary = "Atelier Nord fabrique des meubles pour des architectes."
    _llm(
        monkeypatch,
        [
            {"vague": False, "summary": summary, "memory": {"global": summary}},
            {"ask": True, "question": "Qui chiffre ?"},
            {"ask": True, "question": "Dubois livre le mardi. Qu'est-ce que ça change pour les devis ?"},
        ],
    )
    assert client.post(
        "/context-guide/answer",
        headers=ws["headers"],
        json={"answer": "Atelier Nord fabrique des meubles pour des architectes, à Lille."},
    ).status_code == 200
    assert client.post("/context-guide/confirm", headers=ws["headers"]).status_code == 200

    set_tenant_context(workspace_id=ws["workspace_id"])
    mem = get_enterprise_memory()
    prev = str(mem["contexts"].get("global") or "")
    merge_enterprise_contexts({"global": prev + "\nDubois livre le mardi matin."})

    state = client.get("/context-guide", headers=ws["headers"])
    assert state.status_code == 200, state.text
    assert state.json()["question_stale"] is True
    assert state.json()["question"] == "Qui chiffre ?"

    refreshed = client.post("/context-guide/refresh", headers=ws["headers"])
    assert refreshed.status_code == 200, refreshed.text
    assert "mardi" in refreshed.json()["question"]
    assert refreshed.json()["question_stale"] is False


def test_dismissed_standard_does_not_return(client):
    ws = _workspace(client)
    gone = client.post("/context-guide/dismiss", headers=ws["headers"], json={"id": "standard-chiffres"})
    assert gone.status_code == 200, gone.text
    ids = [item["id"] for item in gone.json()["offers"]]
    assert "standard-chiffres" not in ids
    again = client.get("/context-guide", headers=ws["headers"])
    assert "standard-chiffres" not in [item["id"] for item in again.json()["offers"]]


def test_focus_standard_sets_the_question(client):
    ws = _workspace(client)
    res = client.post("/context-guide/focus", headers=ws["headers"], json={"id": "standard-personnes"})
    assert res.status_code == 200, res.text
    assert "personnes" in res.json()["question"].lower() or "organisations" in res.json()["question"].lower()
    assert res.json()["phase"] == "ask"
    assert res.json()["view"] == "form"


def test_back_returns_to_the_list(client):
    ws = _workspace(client)
    opened = client.post("/context-guide/focus", headers=ws["headers"], json={"id": "standard-chiffres"})
    assert opened.status_code == 200, opened.text
    assert opened.json()["view"] == "form"
    back = client.post("/context-guide/list", headers=ws["headers"])
    assert back.status_code == 200, back.text
    assert back.json()["view"] == "list"
    assert "standard-chiffres" in [item["id"] for item in back.json()["offers"]]


def test_gaps_follow_written_context_and_can_be_hidden(client):
    ws = _workspace(client)
    set_tenant_context(workspace_id=ws["workspace_id"])
    merge_enterprise_contexts(
        {
            "global": (
                "Sorties en mer pour des écoles et des comités d'entreprise, au départ de Toulon. "
                "Les groupes réservent à l'avance."
            )
        }
    )
    state = client.get("/context-guide", headers=ws["headers"])
    assert state.status_code == 200, state.text
    body = state.json()
    assert body["offers_mode"] == "gaps"
    ids = [item["id"] for item in body["offers"]]
    assert "gap-personnes" in ids
    assert "gap-offre" in ids
    assert "gap-chiffres" not in ids
    assert not any(item["id"].startswith("standard-") for item in body["offers"])

    hidden = client.post("/context-guide/dismiss", headers=ws["headers"], json={"id": "gap-offre"})
    assert hidden.status_code == 200, hidden.text
    assert "gap-offre" not in [item["id"] for item in hidden.json()["offers"]]


def test_a_past_request_can_open_a_gap(client):
    from database import append_recent_mission

    ws = _workspace(client)
    set_tenant_context(workspace_id=ws["workspace_id"])
    append_recent_mission(
        "job-devis",
        "Préparer le devis de vendredi, le tarif est à confirmer avant envoi.",
        "devis",
    )
    state = client.get("/context-guide", headers=ws["headers"])
    assert state.status_code == 200, state.text
    ids = [item["id"] for item in state.json()["offers"]]
    assert state.json()["offers_mode"] == "gaps"
    assert ids == ["gap-chiffres"]
