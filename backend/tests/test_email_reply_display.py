from __future__ import annotations

import base64

from services.email_prospecting import isolate_email_reply, clean_outgoing_body
from tools.google_api import extract_gmail_plain_text


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


def test_isolate_gmail_french_snippet():
    raw = (
        "reponse de moi Le mer. 9 sept. 2026 à 18:38, eric ludinart "
        "&lt;eludinart@gmail.com&gt; a écrit : Bonjour Camille, Je me permets "
        "de vous écrire après avoir découvert votre accompagnement autour du corps"
    )
    reply, quoted = isolate_email_reply(raw)
    assert reply == "reponse de moi"
    assert quoted.startswith("Le mer.")
    assert "<eludinart@gmail.com>" in quoted
    assert "Bonjour Camille" in quoted


def test_isolate_gmail_french_multiline():
    raw = (
        "Oui, ça m'intéresse.\n\n"
        "Le mer. 9 sept. 2026 à 18:38, eric ludinart <eludinart@gmail.com> a écrit :\n\n"
        "> Bonjour Camille,"
    )
    reply, quoted = isolate_email_reply(raw)
    assert reply == "Oui, ça m'intéresse."
    assert "Bonjour Camille" in quoted


def test_extract_gmail_prefers_plain_over_html():
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {
                "mimeType": "text/plain",
                "body": {"data": _b64("reponse de moi\n\nLe mer. 9 sept. 2026 à 18:38, x a écrit :\n")},
            },
            {
                "mimeType": "text/html",
                "body": {"data": _b64("<div>reponse de moi</div><blockquote>cité</blockquote>")},
            },
        ],
    }
    text = extract_gmail_plain_text(payload)
    assert text.startswith("reponse de moi")
    assert "<div>" not in text


def test_suggest_email_replies_llm_and_fallback(client, monkeypatch):
    from services.business_db import create_contact
    from services.email_prospecting import record_inbound_reply, record_outbound_email, suggest_email_replies

    contact = create_contact(
        name="Camille Sève",
        email="camille@example.com",
        contact_type="prospect",
        notes="Atelier Sève & Sens",
    )
    cid = contact["id"]
    recorded = record_outbound_email(
        contact_id=cid,
        to_email="camille@example.com",
        subject="Proposition Fleur d'ÅmÔurs — enrichir Atelier Sève & Sens",
        body="Bonjour Camille,\n\nProposition module.",
    )
    record_inbound_reply(
        contact_id=cid,
        thread=recorded["thread"],
        subject="Re: Proposition",
        body="Oui ça m'intéresse, on peut en parler.",
        from_email="camille@example.com",
        gmail_message_id="gmsg-suggest-1",
    )

    listed = client.get(f"/business/contacts/{cid}/emails")
    thread_id = listed.json()["threads"][0]["id"]
    inbound_id = next(
        m["id"] for m in listed.json()["threads"][0]["messages"] if m["direction"] == "inbound"
    )

    captured: dict = {}

    def fake_llm(*a, **k):
        content = ""
        if len(a) >= 2 and isinstance(a[1], list) and a[1]:
            content = str((a[1][0] or {}).get("content") or "")
        captured["user"] = content
        return (
            '{"suggestions":['
            '{"label":"Chaleureux","angle":"Ouverture","subject":"Re: Proposition","body":"Corps chaleureux"},'
            '{"label":"Concret","angle":"Créneau","subject":"Re: Proposition","body":"Corps concret"},'
            '{"label":"Prudent","angle":"Rythme","subject":"Re: Proposition","body":"Corps prudent"}'
            "]}",
            10,
            20,
        )

    monkeypatch.setattr("llm_client.llm_chat", fake_llm)
    r = client.post(
        f"/business/contacts/{cid}/emails/suggest-replies",
        json={
            "thread_id": thread_id,
            "message_id": inbound_id,
            "guidance": "proposer un créneau mardi matin",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "llm"
    assert len(r.json()["suggestions"]) == 3
    assert r.json()["suggestions"][0]["body"] == "Corps chaleureux"
    assert r.json()["guidance"] == "proposer un créneau mardi matin"
    assert captured["user"]
    assert "proposer un créneau mardi matin" in captured["user"]
    assert "Sève" in captured["user"] or "Camille" in captured["user"]
    assert "Proposition module" in captured["user"]
    assert "Historique du fil" in captured["user"]

    monkeypatch.setattr("llm_client.llm_chat", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no llm")))
    fb = suggest_email_replies(cid, thread_id=thread_id, message_id=inbound_id)
    assert fb["source"] == "fallback"
    assert len(fb["suggestions"]) == 3
    assert "Camille" in fb["suggestions"][0]["body"]


def test_clean_outgoing_body_strips_gmail_quote():
    raw = (
        "Oui, mardi matin me va.\n\n"
        "Le mer. 9 sept. 2026 à 18:38, eric ludinart <eludinart@gmail.com> a écrit :\n\n"
        "> Bonjour Camille,"
    )
    assert clean_outgoing_body(raw) == "Oui, mardi matin me va."


def test_suggestions_strip_quoted_history(client, monkeypatch):
    from services.business_db import create_contact
    from services.email_prospecting import record_inbound_reply, record_outbound_email

    contact = create_contact(name="Camille", email="camille-quote@example.com", contact_type="prospect")
    cid = contact["id"]
    recorded = record_outbound_email(
        contact_id=cid,
        to_email="camille-quote@example.com",
        subject="Proposition",
        body="Bonjour Camille,\n\nProposition module.",
    )
    record_inbound_reply(
        contact_id=cid,
        thread=recorded["thread"],
        subject="Re: Proposition",
        body="Oui ça m'intéresse.",
        from_email="camille-quote@example.com",
        gmail_message_id="gmsg-quote-1",
    )
    monkeypatch.setattr(
        "llm_client.llm_chat",
        lambda *a, **k: (
            '{"suggestions":['
            '{"label":"Chaleureux","angle":"x","subject":"Re: Proposition",'
            '"body":"Merci Camille.\\n\\nLe mer. 9 sept. 2026 à 18:38, eric a écrit :\\n> Ancien mail"},'
            '{"label":"Concret","angle":"y","subject":"Re: Proposition","body":"On avance."},'
            '{"label":"Prudent","angle":"z","subject":"Re: Proposition","body":"Pas d urgency."}'
            "]}",
            1,
            1,
        ),
    )
    listed = client.get(f"/business/contacts/{cid}/emails")
    thread_id = listed.json()["threads"][0]["id"]
    r = client.post(
        f"/business/contacts/{cid}/emails/suggest-replies",
        json={"thread_id": thread_id},
    )
    assert r.status_code == 200, r.text
    body = r.json()["suggestions"][0]["body"]
    assert "Merci Camille" in body
    assert "a écrit" not in body.lower()
    assert "Ancien mail" not in body


def test_delete_outbound_message_and_thread(client):
    from services.business_db import create_contact
    from services.email_prospecting import record_inbound_reply, record_outbound_email

    contact = create_contact(
        name="Camille Sève",
        email="camille-del@example.com",
        contact_type="prospect",
    )
    cid = contact["id"]
    recorded = record_outbound_email(
        contact_id=cid,
        to_email="camille-del@example.com",
        subject="Proposition test ménage",
        body="Bonjour Camille,\n\nProposition module.",
    )
    record_inbound_reply(
        contact_id=cid,
        thread=recorded["thread"],
        subject="Re: Proposition test ménage",
        body="Oui ça m'intéresse.",
        from_email="camille-del@example.com",
        gmail_message_id="gmsg-del-1",
    )
    listed = client.get(f"/business/contacts/{cid}/emails")
    thread = listed.json()["threads"][0]
    outbound_id = next(m["id"] for m in thread["messages"] if m["direction"] == "outbound")
    inbound_id = next(m["id"] for m in thread["messages"] if m["direction"] == "inbound")

    blocked = client.delete(f"/business/contacts/{cid}/emails/messages/{inbound_id}")
    assert blocked.status_code == 422, blocked.text

    gone_msg = client.delete(f"/business/contacts/{cid}/emails/messages/{outbound_id}")
    assert gone_msg.status_code == 200, gone_msg.text
    remaining = gone_msg.json()["threads"][0]["messages"]
    assert all(m["direction"] != "outbound" for m in remaining)

    gone_thread = client.delete(f"/business/contacts/{cid}/emails/threads/{thread['id']}")
    assert gone_thread.status_code == 200, gone_thread.text
    listed2 = client.get(f"/business/contacts/{cid}/emails")
    assert listed2.json()["threads"] == []


def test_mailbox_lists_threads_and_syncs(client, monkeypatch):
    from services.business_db import create_contact
    from services.email_prospecting import record_inbound_reply, record_outbound_email

    waiting = create_contact(
        name="Prospect Attente",
        email="attente-mail@example.com",
        contact_type="prospect",
    )
    replied = create_contact(
        name="Prospect Réponse",
        email="reponse-mail@example.com",
        contact_type="prospect",
    )
    record_outbound_email(
        contact_id=waiting["id"],
        to_email="attente-mail@example.com",
        subject="Proposition attente",
        body="Bonjour,\n\nProposition.",
    )
    rec = record_outbound_email(
        contact_id=replied["id"],
        to_email="reponse-mail@example.com",
        subject="Proposition réponse",
        body="Bonjour,\n\nProposition.",
    )
    record_inbound_reply(
        contact_id=replied["id"],
        thread=rec["thread"],
        subject="Re: Proposition réponse",
        body="Oui ça m'intéresse.",
        from_email="reponse-mail@example.com",
        gmail_message_id="gmsg-mbox-1",
    )

    listed = client.get("/business/emails")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert "threads" in body
    assert "counts" in body
    buckets = {t["id"]: t["bucket"] for t in body["threads"]}
    assert buckets.get(rec["thread"]["id"]) == "needs_reply"
    needs = client.get("/business/emails?bucket=needs_reply")
    assert needs.status_code == 200
    assert all(t["bucket"] == "needs_reply" for t in needs.json()["threads"])
    assert any(t["contact_id"] == replied["id"] for t in needs.json()["threads"])

    monkeypatch.setattr(
        "services.email_prospecting.sync_gmail_replies_for_contact",
        lambda cid, **k: {"success": True, "imported": 0, "updated": 0, "skipped": 1},
    )
    synced = client.post("/business/emails/sync")
    assert synced.status_code == 200, synced.text
    assert synced.json()["success"] is True
    assert synced.json()["contacts_attempted"] >= 2
