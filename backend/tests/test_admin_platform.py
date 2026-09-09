"""Contrats admin inbox / analytics / briefing / notifications."""
from __future__ import annotations

import json

from database import get_job, insert_director_notification, save_job, update_job


def test_admin_inbox(client):
    r = client.get("/admin/inbox")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    assert isinstance(body["items"], list)


def test_admin_inbox_cio_question_exposes_questions(client):
    save_job("cioinbx1", "coordinateur", "Mission tarot éditeurs", source="test")
    update_job(
        "cioinbx1",
        "running",
        None,
        [],
        0,
        0,
        events=[
            {
                "type": "cio_question",
                "ts": "2026-01-01T00:00:00",
                "payload": {"questions": ["Souhaitez-vous céder les droits d'édition ?"], "answered": False},
            },
        ],
    )
    r = client.get("/admin/inbox")
    assert r.status_code == 200
    item = next(i for i in r.json()["items"] if i.get("job_id") == "cioinbx1" and i.get("kind") == "cio_question")
    assert item["title"] == "Souhaitez-vous céder les droits d'édition ?"
    assert item["mission"] == "Mission tarot éditeurs"
    assert item["questions"] == ["Souhaitez-vous céder les droits d'édition ?"]
    assert "created_at" in item
    assert "days_open" in item
    assert "progress_label" in item

    dismiss = client.post(
        "/admin/inbox/dismiss",
        json={"kind": "cio_question", "job_id": "cioinbx1"},
    )
    assert dismiss.status_code == 200
    assert dismiss.json().get("dismissed") is True
    r2 = client.get("/admin/inbox")
    assert not any(
        i.get("job_id") == "cioinbx1" and i.get("kind") == "cio_question" for i in r2.json()["items"]
    )


def test_admin_inbox_dismiss_accepts_long_job_id(client):
    long_id = "delivlib1_bc4fc7ca"
    save_job(long_id, "coordinateur", "Mission id long", source="test")
    update_job(
        long_id,
        "running",
        None,
        [],
        0,
        0,
        events=[
            {
                "type": "cio_question",
                "ts": "2026-01-01T00:00:00",
                "payload": {"questions": ["Question long id ?"], "answered": False},
            },
        ],
    )
    dismiss = client.post(
        "/admin/inbox/dismiss",
        json={"kind": "cio_question", "job_id": long_id},
    )
    assert dismiss.status_code == 200
    assert dismiss.json().get("dismiss_key") == f"cio_question:{long_id}"


def test_admin_inbox_includes_chat_closures(client):
    save_job("chatinbx1", "coordinateur", "Prospection chat à clôturer", source="chat")
    update_job("chatinbx1", "completed", "Résultat chat", [], 0, 0)
    r = client.get("/admin/inbox?limit=80")
    assert r.status_code == 200
    item = next(i for i in r.json()["items"] if i.get("job_id") == "chatinbx1" and i.get("kind") == "closure")
    assert "Prospection chat" in (item.get("title") or "")


def test_admin_inbox_includes_mission_errors(client):
    save_job("errinbx1", "coordinateur", "Mission cassée", source="mission")
    update_job("errinbx1", "error: Délai dépassé HITL", "échec", [], 0, 0)
    r = client.get("/admin/inbox?limit=80")
    assert r.status_code == 200
    item = next(i for i in r.json()["items"] if i.get("job_id") == "errinbx1" and i.get("kind") == "mission_error")
    assert "Délai" in (item.get("title") or "") or "HITL" in (item.get("title") or "")


def test_admin_inbox_close_bulk(client):
    save_job("bulkcl01", "coordinateur", "À clôturer en masse", source="chat")
    update_job("bulkcl01", "completed", "ok", [], 0, 0)
    r = client.post("/admin/inbox/close-bulk", json={"kinds": ["closure"], "limit": 80})
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert "bulkcl01" in (body.get("closed") or [])
    r2 = client.get("/admin/inbox?limit=80")
    assert not any(i.get("job_id") == "bulkcl01" and i.get("kind") == "closure" for i in r2.json()["items"])


def test_admin_briefing(client):
    r = client.get("/admin/briefing?period=today")
    assert r.status_code == 200
    body = r.json()
    assert body["period"] == "today"
    assert "decisions_today" in body
    assert "budget" in body
    assert "executive_summary" in body
    assert isinstance(body["executive_summary"], str)
    assert "top_priorities" in body
    assert isinstance(body["top_priorities"], list)
    assert "memory_highlights" in body
    assert "unconsulted_results" in body
    assert isinstance(body["unconsulted_results"], list)
    assert body["ritual_status"] in ("clear", "decisions_needed", "budget_alert")
    assert "commercial" in body
    assert "counts" in body["commercial"]


def test_admin_inbox_crm_follow_up_and_prepare(client):
    from datetime import datetime

    from services.business_db import create_calendar_event, create_contact

    contact = create_contact(name="Prospect Relance", email="relance@example.com")
    today = datetime.utcnow().replace(hour=10, minute=0, second=0, microsecond=0)
    event = create_calendar_event(
        title=f"Relance — {contact['name']}",
        starts_at=today.isoformat(),
        ends_at=(today.replace(minute=30)).isoformat(),
        contact_id=contact["id"],
        event_type="autre",
        notes="Suite devis",
    )
    inbox = client.get("/admin/inbox")
    assert inbox.status_code == 200
    item = next(
        i
        for i in inbox.json()["items"]
        if i.get("kind") == "crm_follow_up" and i.get("event_id") == event["id"]
    )
    assert "Relance" in (item.get("title") or "")
    assert item.get("primary_cta")

    prepared = client.post(f"/business/events/{event['id']}/prepare-follow-up-email")
    assert prepared.status_code == 200, prepared.text
    body = prepared.json()
    assert body.get("success") is True
    assert body.get("ticket", {}).get("id")
    assert any("Brouillon" in s or "e-mail" in s.lower() for s in (body.get("chain") or {}).get("steps") or [])

    inbox2 = client.get("/admin/inbox")
    assert not any(
        i.get("kind") == "crm_follow_up" and i.get("event_id") == event["id"] for i in inbox2.json()["items"]
    )
    assert any(
        i.get("kind") == "action_ticket" and i.get("ticket_id") == body["ticket"]["id"]
        for i in inbox2.json()["items"]
    )


def test_admin_inbox_dismiss_crm_follow_up(client):
    from datetime import datetime

    from services.business_db import create_calendar_event, create_contact

    contact = create_contact(name="Dismiss Relance", email="dismiss-relance@example.com")
    today = datetime.utcnow().replace(hour=11, minute=0, second=0, microsecond=0)
    event = create_calendar_event(
        title="Relance — Dismiss",
        starts_at=today.isoformat(),
        contact_id=contact["id"],
        event_type="autre",
    )
    dismiss = client.post(
        "/admin/inbox/dismiss",
        json={"kind": "crm_follow_up", "event_id": event["id"]},
    )
    assert dismiss.status_code == 200
    assert dismiss.json().get("dismiss_key") == f"crm_follow_up:{event['id']}"
    inbox = client.get("/admin/inbox")
    assert not any(
        i.get("kind") == "crm_follow_up" and i.get("event_id") == event["id"] for i in inbox.json()["items"]
    )


def test_complete_crm_follow_up_snooze(client):
    from datetime import datetime

    from services.business_db import create_calendar_event, get_calendar_event

    today = datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0)
    event = create_calendar_event(
        title="Mesurer / republier — test",
        starts_at=today.isoformat(),
        event_type="autre",
    )
    done = client.post(
        f"/business/events/{event['id']}/complete-follow-up",
        json={"snooze_days": 3},
    )
    assert done.status_code == 200, done.text
    assert done.json().get("snoozed_days") == 3
    updated = get_calendar_event(event["id"])
    assert updated and updated.get("status") == "planned"
    assert str(updated.get("starts_at") or "") > today.isoformat()


def test_unconsulted_results_mark_and_briefing(client):
    from database import save_job, update_job

    save_job("uncons01", "coordinateur", "Mission résultat non lu", source="mission")
    update_job("uncons01", "completed", "## Synthèse\nTout va bien", [], 0, 0)

    briefing = client.get("/admin/briefing?period=today")
    assert briefing.status_code == 200
    items = briefing.json().get("unconsulted_results") or []
    assert any(i.get("job_id") == "uncons01" for i in items)

    marked = client.post("/jobs/uncons01/result-consulted")
    assert marked.status_code == 200
    assert marked.json().get("result_consulted_at")
    again = client.post("/jobs/uncons01/result-consulted")
    assert again.status_code == 200
    assert again.json().get("already") is True

    briefing2 = client.get("/admin/briefing?period=today")
    items2 = briefing2.json().get("unconsulted_results") or []
    assert not any(i.get("job_id") == "uncons01" for i in items2)

def test_chat_conversations_crud(client):
    cid = "conv-test-01"
    put = client.put(
        f"/chat/conversations/{cid}",
        json={
            "id": cid,
            "title": "Test conv",
            "messages": [{"id": "m1", "role": "user", "content": "Bonjour"}],
        },
    )
    assert put.status_code == 200
    assert put.json()["id"] == cid
    lst = client.get("/chat/conversations")
    assert lst.status_code == 200
    assert any(c["id"] == cid for c in lst.json()["conversations"])
    get = client.get(f"/chat/conversations/{cid}")
    assert get.status_code == 200
    assert get.json()["messages"][0]["content"] == "Bonjour"
    delete = client.delete(f"/chat/conversations/{cid}")
    assert delete.status_code == 200
    assert client.get(f"/chat/conversations/{cid}").status_code == 404


def test_admin_notifications_crud(client):
    row = insert_director_notification(kind="test", title="Test notif", body="hello")
    nid = row["id"]
    r = client.get("/admin/notifications?unread_only=true")
    assert r.status_code == 200
    assert any(i["id"] == nid for i in r.json()["items"])
    r2 = client.patch(f"/admin/notifications/{nid}/read")
    assert r2.status_code == 200
    assert r2.json().get("read_at")


def test_cio_answer_marks_answered(client):
    save_job("cioans01", "coordinateur", "Test CIO answer", source="test")
    update_job(
        "cioans01",
        "running",
        None,
        [],
        0,
        0,
        events=[
            {"type": "cio_question", "ts": "2026-01-01T00:00:00", "payload": {"questions": ["Q1?"], "answered": False}},
        ],
    )
    r = client.post("/jobs/cioans01/cio-answer", json={"answer": "Réponse test"})
    assert r.status_code == 200
    row = get_job("cioans01")
    events = row.get("events") or []
    assert any(
        ev.get("type") == "cio_question"
        and (
            (ev.get("payload") or {}).get("answered") is True or (ev.get("data") or {}).get("answered") is True
        )
        for ev in events
    )


def test_cio_answer_per_question(client):
    from database import get_job, list_cio_arbitrage_answers, save_job, update_job

    qs = [
        "Question A pour le dirigeant ?",
        "Question B pour le dirigeant ?",
    ]
    save_job("cioq2", "coordinateur", "Mission arbitrages", source="test")
    update_job(
        "cioq2",
        "running",
        None,
        [],
        0,
        0,
        events=[
            {
                "type": "cio_question",
                "ts": "2026-01-01T00:00:00",
                "payload": {"questions": qs, "answered": False},
            },
        ],
    )
    r = client.post(
        "/jobs/cioq2/cio-answer",
        json={"question": qs[0], "answer": "Réponse A"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["question_answers"][qs[0]] == "Réponse A"
    row = get_job("cioq2")
    events = row.get("events") or []
    cq = next(ev for ev in events if ev.get("type") == "cio_question")
    pl = cq.get("payload") or cq.get("data") or {}
    assert pl.get("question_answers", {}).get(qs[0]) == "Réponse A"
    assert pl.get("answered") is not True
    assert list_cio_arbitrage_answers("cioq2")[qs[0]] == "Réponse A"

    r2 = client.post(
        "/jobs/cioq2/cio-answer",
        json={"question": qs[1], "answer": "Réponse B"},
    )
    assert r2.status_code == 200
    row2 = get_job("cioq2")
    cq2 = next(ev for ev in row2.get("events") or [] if ev.get("type") == "cio_question")
    pl2 = cq2.get("payload") or cq2.get("data") or {}
    assert pl2.get("answered") is True


def test_cio_answer_large_mission_thread(client):
    """Fil proche de la limite TEXT MariaDB (~64 Ko) : l'append ne doit pas échouer."""
    from database import append_job_mission_thread, init_db

    init_db()
    save_job("ciobig01", "coordinateur", "Gros fil CIO", source="test")
    big = "x" * 3000
    for i in range(22):
        append_job_mission_thread(
            "ciobig01",
            role="assistant",
            agent="coordinateur",
            content=f"[Bloc {i}] {big}",
            source="mission",
        )
    r = client.post("/jobs/ciobig01/cio-answer", json={"answer": "Réponse dirigeant sur fil long"})
    assert r.status_code == 200, r.text
    row = get_job("ciobig01")
    thread = row.get("mission_thread") or []
    assert any("[Réponse questions CIO]" in str(m.get("content") or "") for m in thread if isinstance(m, dict))


def test_missions_estimate_cost(client):
    r = client.post(
        "/missions/estimate-cost",
        json={"mission": "Analyser le marché local", "agents": ["commercial"], "mode": "cio"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["estimated_tokens"] > 0
    assert "estimated_cost_usd" in body


def test_playbooks_list(client):
    r = client.get("/playbooks")
    assert r.status_code == 200
    assert "playbooks" in r.json()


def test_jobs_summary(client):
    r = client.get("/jobs/summary?limit=5")
    assert r.status_code == 200
    assert "jobs" in r.json()


def test_jobs_cards_light(client):
    r = client.get("/jobs/cards?limit=5")
    assert r.status_code == 200
    body = r.json()
    assert "jobs" in body
    assert isinstance(body["jobs"], list)


def test_admin_mission_analytics(client):
    r = client.get("/admin/mission-analytics?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["days"] == 7
    assert "missions_total" in body


def test_scheduler_generate_proposals(client, monkeypatch):
    async def _fake_generate(*, nb_proposals=3, task_id="on-demand"):
        from database import create_autonomous_output

        outputs = [
            create_autonomous_output(
                task_id=task_id,
                output_type="mission_proposal",
                title=f"Proposition {i + 1}",
                content=json.dumps({"description": f"Mission test {i + 1}"}, ensure_ascii=False),
            )
            for i in range(nb_proposals)
        ]
        return {"created": len(outputs), "outputs": outputs}

    monkeypatch.setattr(
        "services.veille.generate_mission_proposals_now",
        _fake_generate,
    )
    r = client.post("/scheduler/proposals/generate", json={"nb_proposals": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["created"] == 2
    assert len(body["outputs"]) == 2
    listed = client.get("/scheduler/outputs?status=pending&output_type=mission_proposal")
    assert listed.status_code == 200
    assert listed.json()["total"] >= 2


def test_build_ecosystem_proposal_context(client):
    save_job("ctxprop1", "coordinateur", "Mission éditeurs tarot", source="test")
    update_job(
        "ctxprop1",
        "running",
        None,
        [],
        0,
        0,
        events=[
            {
                "type": "cio_question",
                "ts": "2026-01-01T00:00:00",
                "payload": {"questions": ["Céder les droits ?"], "answered": False},
            },
        ],
    )
    from services.proposal_context import build_ecosystem_proposal_context, format_context_for_prompt

    ctx = build_ecosystem_proposal_context()
    assert "pending_decisions" in ctx
    kinds = [p.get("kind") for p in ctx["pending_decisions"] if isinstance(p, dict)]
    assert "cio_question" in kinds
    text = format_context_for_prompt(ctx)
    assert "Décisions en attente" in text
    assert "ctxprop1" in text or "Céder" in text


def test_generate_proposals_enriched_meta(client, monkeypatch):
    def _fake_llm(prompt, **kwargs):
        payload = json.dumps(
            [
                {
                    "title": "Relance éditeurs",
                    "content": "Comparer 3 modèles de contrat éditeur.",
                    "why_now": "Question CIO en attente",
                    "agents": ["commercial"],
                    "source_kind": "cio_question",
                    "source_job_id": "ctxprop1",
                    "source_label": "Suite à la question CIO",
                    "launch_mode": "supervised",
                }
            ],
            ensure_ascii=False,
        )
        return payload, 0, 0

    monkeypatch.setattr("llm_client.llm_turn", _fake_llm)
    from services.veille import _generate_mission_proposals

    out = _generate_mission_proposals(1, {"id": "test-task"})
    assert len(out) == 1
    blob = json.loads(out[0]["content"])
    assert blob["source_kind"] == "cio_question"
    assert blob["source_job_id"] == "ctxprop1"
    assert blob["proposed_by_agent"] == "commercial"


def test_reprise_coverage_scan(client):
    from database import merge_enterprise_contexts

    merge_enterprise_contexts({
        "global": "Projet de reprise Élude In Art — cession en cours, due diligence juridique lancée.",
    })
    r = client.get("/admin/reprise/coverage")
    assert r.status_code == 200
    body = r.json()
    assert "domains" in body
    assert body["summary"]["total_domains"] >= 10
    assert body["has_reprise_context"] is True
    ids = [d["id"] for d in body["domains"]]
    assert "gouvernance_juridique" in ids
    assert "editorial_tarot" in ids


def test_reprise_item_action_validates_and_updates_coverage(client):
    r0 = client.get("/admin/reprise/coverage")
    assert r0.status_code == 200
    domain = next(
        d for d in r0.json()["domains"] if d["id"] == "conformite_rgpd"
    )
    item = (domain.get("checklist_missing") or domain.get("checklist_covered") or [None])[0]
    assert item

    r = client.post(
        "/admin/reprise/actions",
        json={
            "domain_id": "conformite_rgpd",
            "item_text": item,
            "action": "validated",
            "note": "Registre à jour chez le DPO externe",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["action"]["action"] == "validated"
    key = f"conformite_rgpd::{item}"
    assert key in (body["coverage"].get("user_actions") or {})

    r2 = client.get("/admin/reprise/coverage")
    assert r2.status_code == 200
    dom2 = next(d for d in r2.json()["domains"] if d["id"] == "conformite_rgpd")
    assert item in dom2.get("checklist_covered", [])


def test_reprise_item_action_ignore_and_reopen(client):
    from database import merge_enterprise_contexts

    merge_enterprise_contexts({
        "global": "Projet de reprise Élude In Art — cession en cours.",
    })
    r0 = client.get("/admin/reprise/coverage")
    assert r0.status_code == 200
    domain = next(
        d for d in r0.json()["domains"]
        if d.get("checklist_missing") and d.get("status") != "dormant"
    )
    domain_id = domain["id"]
    item = domain["checklist_missing"][0]

    r = client.post(
        "/admin/reprise/actions",
        json={"domain_id": domain_id, "item_text": item, "action": "ignored"},
    )
    assert r.status_code == 200
    dom = next(d for d in r.json()["coverage"]["domains"] if d["id"] == domain_id)
    assert item in dom.get("checklist_ignored", [])
    assert item not in dom.get("checklist_missing", [])
    assert item not in dom.get("checklist_covered", [])

    r2 = client.post(
        "/admin/reprise/actions/reopen",
        json={"domain_id": domain_id, "item_text": item},
    )
    assert r2.status_code == 200
    dom2 = next(d for d in r2.json()["coverage"]["domains"] if d["id"] == domain_id)
    assert item not in dom2.get("checklist_ignored", [])
    assert item in dom2.get("checklist_missing", []) or item in dom2.get("checklist_covered", [])


def test_reprise_item_action_defer_covered_item(client):
    from database import merge_enterprise_contexts

    merge_enterprise_contexts({
        "global": "Projet de reprise Élude In Art — cession en cours.",
    })
    r0 = client.get("/admin/reprise/coverage")
    domain = next(
        d for d in r0.json()["domains"]
        if d.get("checklist_missing") and d.get("status") != "dormant"
    )
    domain_id = domain["id"]
    item = domain["checklist_missing"][0]

    r = client.post(
        "/admin/reprise/actions",
        json={"domain_id": domain_id, "item_text": item, "action": "deferred"},
    )
    assert r.status_code == 200
    dom = next(d for d in r.json()["coverage"]["domains"] if d["id"] == domain_id)
    assert item in dom.get("checklist_deferred", [])
    assert item not in dom.get("checklist_missing", [])
    assert item not in dom.get("checklist_covered", [])


def test_reprise_items_launch_starts_job(client):
    r = client.post(
        "/admin/reprise/items/launch",
        json={
            "items": [
                {
                    "domain_id": "conformite_rgpd",
                    "item_text": "Vérifier le registre des traitements et la politique privacy",
                    "note": "DPO externe mandate",
                }
            ],
            "launch_mode": "supervised",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["launched"] == 1
    assert body["jobs"][0]["job_id"]
    assert "global" in body["memory_contexts_updated"]
    key = "conformite_rgpd::Vérifier le registre des traitements et la politique privacy"
    assert body["coverage"]["user_actions"][key]["action"] == "agent_launched"


def test_reprise_items_launch_relaunch_on_validated(client):
    item = "Vérifier le registre des traitements et la politique privacy"
    client.post(
        "/admin/reprise/actions",
        json={
            "domain_id": "conformite_rgpd",
            "item_text": item,
            "action": "validated",
            "note": "Registre à jour chez le DPO externe",
        },
    )
    r = client.post(
        "/admin/reprise/items/launch",
        json={
            "items": [{"domain_id": "conformite_rgpd", "item_text": item, "note": "Approfondir DPA"}],
            "launch_mode": "supervised",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["launched"] == 1
    assert body["jobs"][0].get("relaunch") is True


def test_reprise_items_missions_creates_outputs(client):
    r = client.post(
        "/admin/reprise/items/missions",
        json={
            "items": [
                {
                    "domain_id": "banque_tresorerie",
                    "item_text": "Vérifier les cautions et garanties bancaires",
                    "note": "Relance banque prévue lundi",
                }
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["created"] == 1
    assert "mission(s)" in body["message"]
    assert body["outputs"][0]["output_type"] == "mission_proposal"


def test_reprise_audit_generates_proposals(client, monkeypatch):
    def _fake_llm(prompt, **kwargs):
        payload = json.dumps(
            [
                {
                    "title": "Matrice éditeurs tarot × droits et redevances",
                    "content": (
                        "Objectif : cartographier chaque éditeur partenaire.\n"
                        "Livrables :\n- Tableau éditeur / jeu / titulaire des droits\n"
                        "- Liste des contrats à renégocier\n"
                        "Critère de succès : matrice validée par le dirigeant."
                    ),
                    "why_now": "Question CIO sur cession des droits en attente",
                    "agents": ["commercial"],
                    "reprise_domain": "editorial_tarot",
                    "checklist_items_addressed": ["Lister les éditeurs partenaires"],
                    "source_label": "Lacune éditeurs tarot",
                    "launch_mode": "supervised",
                }
            ],
            ensure_ascii=False,
        )
        return payload, 0, 0

    monkeypatch.setattr("llm_client.llm_turn", _fake_llm)
    # Contexte écosystème vide : les contextes mémoire par défaut couvrent déjà
    # toute la checklist reprise — on force des lacunes pour rendre le test hermétique.
    monkeypatch.setattr(
        "services.reprise_audit.build_ecosystem_proposal_context",
        lambda **kwargs: {"memory_contexts": {}},
    )
    r = client.post("/admin/reprise/audit", json={"nb_proposals": 1, "generate_proposals": True})
    assert r.status_code == 200
    body = r.json()
    assert body["created"] >= 1
    assert "Matrice éditeurs" in body["outputs"][0]["title"]
    blob = json.loads(body["outputs"][0]["content"])
    assert blob["source_kind"] == "reprise_gap"
    assert blob["reprise_domain"] == "editorial_tarot"
