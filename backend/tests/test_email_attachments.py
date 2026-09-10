from __future__ import annotations

import base64

from services.email_files import build_email_message, parse_attachments, save_upload, serialize_attachments
from tools.google_api import extract_gmail_attachments


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def test_extract_gmail_named_attachment():
    payload = {
        "mimeType": "multipart/mixed",
        "parts": [
            {"mimeType": "text/plain", "filename": "", "body": {"data": _b64(b"bonjour")}},
            {
                "mimeType": "application/pdf",
                "filename": "devis.pdf",
                "body": {"attachmentId": "ANGjd-att-1", "size": 1234},
            },
        ],
    }
    atts = extract_gmail_attachments(payload)
    assert len(atts) == 1
    assert atts[0]["filename"] == "devis.pdf"
    assert atts[0]["gmail_attachment_id"] == "ANGjd-att-1"
    assert atts[0]["id"].startswith("gatt-")


def test_serialize_attachments_roundtrip():
    raw = serialize_attachments(
        [{"id": "efil-abc", "filename": "note.txt", "mime": "text/plain", "size": 4, "source": "local"}]
    )
    parsed = parse_attachments(raw)
    assert parsed[0]["filename"] == "note.txt"
    assert parsed[0]["id"] == "efil-abc"


def test_build_email_message_includes_attachment(tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_MAIL_FILES_DIR", str(tmp_path))
    saved = save_upload(filename="note.txt", mime="text/plain", data=b"hello-korymb")
    assert saved.get("success")
    msg = build_email_message(
        to="camille@example.com",
        subject="Proposition",
        body="Bonjour",
        attachments=[saved["file"]],
    )
    raw = msg.as_string()
    assert "note.txt" in raw
    assert "Bonjour" in raw


def test_upload_prepare_and_download(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_MAIL_FILES_DIR", str(tmp_path))
    from services.business_db import create_contact

    contact = create_contact(
        name="Camille PJ",
        email="camille.pj@example.com",
        contact_type="prospect",
    )
    uploaded = client.post(
        "/business/email-files",
        files={"file": ("brochure.pdf", b"%PDF-1.4 korymb", "application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.text
    file_meta = uploaded.json().get("file") or {}
    assert file_meta.get("id", "").startswith("efil-")

    prep = client.post(
        f"/business/contacts/{contact['id']}/emails/prepare",
        json={
            "subject": "Proposition + brochure",
            "body": "Voir la PJ",
            "attachment_ids": [file_meta["id"]],
        },
    )
    assert prep.status_code == 200, prep.text
    atts = ((prep.json().get("ticket") or {}).get("payload") or {}).get("attachments") or []
    assert atts and atts[0]["filename"] == "brochure.pdf"

    dl = client.get(f"/business/email-files/{file_meta['id']}")
    assert dl.status_code == 200
    assert dl.content == b"%PDF-1.4 korymb"
    assert "brochure.pdf" in (dl.headers.get("content-disposition") or "")


def test_reject_executable_upload(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_MAIL_FILES_DIR", str(tmp_path))
    uploaded = client.post(
        "/business/email-files",
        files={"file": ("virus.exe", b"MZ", "application/octet-stream")},
    )
    assert uploaded.status_code == 422


def test_record_inbound_attachments_and_download(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_MAIL_FILES_DIR", str(tmp_path))
    from services.business_db import create_contact
    from services.email_prospecting import record_inbound_reply, record_outbound_email

    contact = create_contact(name="Lise PJ", email="lise.pj@example.com", contact_type="prospect")
    recorded = record_outbound_email(
        contact_id=contact["id"],
        to_email="lise.pj@example.com",
        subject="Proposition",
        body="Bonjour Lise",
    )
    saved = save_upload(filename="reponse.pdf", mime="application/pdf", data=b"%PDF-1.4 inbound")
    rec = record_inbound_reply(
        contact_id=contact["id"],
        thread=recorded["thread"],
        subject="Re: Proposition",
        body="Voici le document.",
        from_email="lise.pj@example.com",
        gmail_message_id="gmsg-pj-1",
        attachments=[saved["file"]],
    )
    message = rec["message"]
    assert message["attachments"][0]["filename"] == "reponse.pdf"
    dl = client.get(f"/business/emails/messages/{message['id']}/attachments/{saved['file']['id']}?inline=true")
    assert dl.status_code == 200, dl.text
    assert dl.content == b"%PDF-1.4 inbound"
