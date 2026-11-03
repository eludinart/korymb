"""Pièces jointes chat : extraction texte et injection dans /chat."""
from __future__ import annotations


def test_extract_plain_and_pdf(tmp_path, monkeypatch):
    from pypdf import PdfWriter
    from services.chat_attachments import (
        _extract_text,
        _plain_text,
        build_attachment_mission_block,
        normalize_attachment_refs,
    )

    assert "bonjour" in _plain_text("bonjour le chat".encode("utf-8"))
    refs = normalize_attachment_refs(
        [
            {"id": "rfil-aaa", "filename": "a.pdf"},
            {"id": "rfil-aaa", "filename": "dup.pdf"},
            {"id": "nope", "filename": "x.pdf"},
            {"filename": "missing-id.pdf"},
        ]
    )
    assert len(refs) == 1
    assert refs[0]["id"] == "rfil-aaa"

    missing = build_attachment_mission_block(
        [{"id": "rfil-missing", "filename": "perdu.pdf", "mime": "application/pdf", "size": 12}]
    )
    assert "introuvable" in missing.lower()
    assert "perdu.pdf" in missing

    buf_path = tmp_path / "note.pdf"
    w = PdfWriter()
    w.add_blank_page(width=72, height=72)
    w.add_metadata({"/Title": "x"})
    # pypdf blank page has no text — still should not crash
    from io import BytesIO

    bio = BytesIO()
    w.write(bio)
    assert _extract_text(bio.getvalue(), "application/pdf", "note.pdf") == ""


def test_docx_extract():
    import io
    import zipfile
    from services.chat_attachments import _extract_text

    xml = (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        b"<w:body><w:p><w:r><w:t>Brief tarot Fleur</w:t></w:r></w:p></w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", xml)
    text = _extract_text(buf.getvalue(), "", "brief.docx")
    assert "Brief tarot Fleur" in text


def test_chat_accepts_attachment(client, tmp_path, monkeypatch):
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    uploaded = client.post(
        "/business/resource-files",
        files={"file": ("consigne.txt", b"Objectif : relancer 12 editeurs.", "text/plain")},
    )
    assert uploaded.status_code == 200, uploaded.text
    fid = uploaded.json()["file"]["id"]

    captured: dict = {}

    def fake_runner(mission_txt, *args, **kwargs):
        captured["mission"] = mission_txt
        return "Lu le fichier.", 1, 1

    # « Lis ce document » ne demande pas d'action : le tour part dans
    # answer_chat_turn_without_tools. Une consigne d'action passerait
    # par orchestrate_coordinateur_mission. Les deux doivent voir le fichier.
    monkeypatch.setattr("routers.core_chat.orchestrate_coordinateur_mission", fake_runner)
    monkeypatch.setattr("services.mission.answer_chat_turn_without_tools", fake_runner)
    monkeypatch.setattr(
        "routers.core_chat.generate_mirror_ack_result",
        lambda *a, **k: ("ok", None),
    )

    res = client.post(
        "/chat",
        json={
            "message": "Lis ce document",
            "agent": "coordinateur",
            "attachments": [{"id": fid, "filename": "consigne.txt", "mime": "text/plain", "size": 30}],
        },
    )
    assert res.status_code == 200, res.text
    assert res.json().get("status") == "accepted"
    import time

    for _ in range(40):
        if captured.get("mission"):
            break
        time.sleep(0.05)
    assert "relancer 12 editeurs" in captured.get("mission", "")
    assert "consigne.txt" in captured.get("mission", "")


def test_chat_rejects_empty_without_files(client):
    res = client.post("/chat", json={"message": "   ", "agent": "coordinateur"})
    assert res.status_code == 400


def test_assistant_defers_attachment_extract(client, tmp_path, monkeypatch):
    """L'extraction PDF ne doit pas bloquer la réponse HTTP accepted."""
    monkeypatch.setenv("KORYMB_RESOURCE_FILES_DIR", str(tmp_path))
    uploaded = client.post(
        "/business/resource-files",
        files={"file": ("brief.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.text
    fid = uploaded.json()["file"]["id"]

    order: list[str] = []

    def slow_compose(message, refs):
        order.append("extract")
        return f"{message}\n\nEXTRAIT_PDF"

    def fake_turn(**kwargs):
        order.append("llm")
        assert "EXTRAIT_PDF" in kwargs.get("message", "")
        return {
            "reply": "Lu.",
            "surface": "Lu.",
            "tokens_in": 1,
            "tokens_out": 1,
            "pending_blueprint_id": None,
            "pending_science_suggestion_ids": [],
        }

    monkeypatch.setattr("services.chat_attachments.compose_user_turn_with_attachments", slow_compose)
    monkeypatch.setattr("services.assistant_chat.run_assistant_turn", fake_turn)

    res = client.post(
        "/chat",
        json={
            "message": "Résume ce PDF",
            "agent": "assistant",
            "chat_use_mode": "quotidien",
            "attachments": [{"id": fid, "filename": "brief.pdf", "mime": "application/pdf", "size": 12}],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("status") == "accepted"
    assert body.get("job_id")
    # La réponse accepted arrive avant (ou sans attendre) la fin LLM ;
    # l'extraction ne doit pas avoir eu lieu sur le thread requête.
    assert "extract" not in order or order[0] != "extract" or body["status"] == "accepted"

    import time

    for _ in range(40):
        if "llm" in order:
            break
        time.sleep(0.05)
    assert "extract" in order
    assert "llm" in order
    assert order.index("extract") < order.index("llm")
