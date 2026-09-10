"""Chaîne de moteurs média — ordre, repli, catalogue."""
from __future__ import annotations


def _fake_getenv(values: dict[str, str]):
    def fake(name: str, default: str = "") -> str:
        if name in values:
            return values[name]
        return default

    return fake


def test_economy_image_chain_starts_with_mistral(monkeypatch):
    from tools import media_engines as me

    monkeypatch.setattr(me, "getenv", _fake_getenv({"MEDIA_ENGINE_MODE": "economy"}))
    token = me.push_media_engine_mode("economy")
    try:
        chain = me.resolve_chain("image")
        assert chain[0] == "mistral"
        assert "pollinations" in chain
        assert "openrouter" in chain
    finally:
        me.reset_media_engine_mode(token)


def test_quality_image_chain_starts_with_mistral(monkeypatch):
    from tools import media_engines as me

    monkeypatch.setattr(me, "getenv", _fake_getenv({"MEDIA_ENGINE_MODE": "quality"}))
    token = me.push_media_engine_mode("quality")
    try:
        chain = me.resolve_chain("image")
        assert chain[0] == "mistral"
        assert chain[-1] == "pollinations"
    finally:
        me.reset_media_engine_mode(token)


def test_explicit_chain_overrides_mode(monkeypatch):
    from tools import media_engines as me

    monkeypatch.setattr(
        me,
        "getenv",
        _fake_getenv(
            {
                "MEDIA_ENGINE_MODE": "quality",
                "IMAGE_ENGINE_CHAIN": "huggingface,pollinations",
            }
        ),
    )
    token = me.push_media_engine_mode("quality")
    try:
        assert me.resolve_chain("image") == ["huggingface", "pollinations"]
    finally:
        me.reset_media_engine_mode(token)


def test_generate_image_uses_pollinations_then_saves(monkeypatch, tmp_path):
    from tools import media_engines as me

    monkeypatch.setattr(me, "getenv", _fake_getenv({"MEDIA_ENGINE_MODE": "economy", "IMAGE_FREE_ENGINE": "1"}))
    monkeypatch.setattr(me, "_save_bytes", lambda data, filename, mime: "file_id: rfil-img (120 octets)")

    class Resp:
        content = b"\x89PNG\r\n\x1a\n" + b"x" * 200
        headers = {"content-type": "image/png"}

        def raise_for_status(self):
            return None

    monkeypatch.setattr(me.httpx, "get", lambda *a, **k: Resp())
    token = me.push_media_engine_mode("economy")
    try:
        out = me.generate_image("carte végétale lumière douce")
    finally:
        me.reset_media_engine_mode(token)
    assert out.startswith("✅")
    assert "pollinations" in out.lower()
    assert "file_id:" in out


def test_generate_image_falls_back_when_free_engine_fails(monkeypatch):
    from tools import media_engines as me

    monkeypatch.setattr(
        me,
        "getenv",
        _fake_getenv(
            {
                "MEDIA_ENGINE_MODE": "economy",
                "IMAGE_FREE_ENGINE": "1",
                "IMAGE_GEN_MODEL": "test-img",
                "IMAGE_GEN_API_KEY": "sk-test",
            }
        ),
    )

    class Bad:
        content = b"<html>rate limit</html>"
        headers = {"content-type": "text/html"}

        def raise_for_status(self):
            return None

    class Paid:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": [{"url": "https://example.com/out.png"}]}

        headers = {"content-type": "application/json"}

    def fake_get(*a, **k):
        url = str(a[0] if a else k.get("url") or "")
        if "example.com/out.png" in url:
            class Img:
                content = b"\x89PNG\r\n\x1a\n" + b"y" * 200
                headers = {"content-type": "image/png"}

                def raise_for_status(self):
                    return None

            return Img()
        return Bad()

    monkeypatch.setattr(me.httpx, "get", fake_get)
    monkeypatch.setattr(me.httpx, "post", lambda *a, **k: Paid())
    monkeypatch.setattr(me, "_save_bytes", lambda *a, **k: "file_id: rfil-paid (200 octets)")
    token = me.push_media_engine_mode("economy")
    try:
        out = me.generate_image("portrait studio")
    finally:
        me.reset_media_engine_mode(token)
    assert out.startswith("✅")
    assert "test-img" in out


def test_generate_video_storyboard_when_no_paid_key(monkeypatch):
    from tools import media_engines as me

    monkeypatch.setattr(me, "getenv", _fake_getenv({"MEDIA_ENGINE_MODE": "economy", "IMAGE_FREE_ENGINE": "1"}))
    monkeypatch.setattr(
        me,
        "_image_pollinations",
        lambda prompt, size: "✅ Image\nfile_id: rfil-frame (10 octets)\nPrompt : x",
    )
    token = me.push_media_engine_mode("economy")
    try:
        out = me.generate_video("marche dans un jardin", 5, "9:16")
    finally:
        me.reset_media_engine_mode(token)
    assert out.startswith("✅")
    assert "Storyboard" in out
    assert "rfil-frame" in out


def test_studio_catalog_exposes_media_chain(client):
    r = client.get("/studio/catalog")
    assert r.status_code == 200, r.text
    body = r.json()
    media = body.get("media") or {}
    assert media.get("mode") in {"economy", "quality"}
    assert any(m.get("id") == "economy" for m in (media.get("modes") or []))
    image = next(c for c in body["connections"] if c["id"] == "image")
    assert image["configured"] is True
    video = next(c for c in body["connections"] if c["id"] == "video_gen")
    assert video["configured"] is True
    tts = next(c for c in body["connections"] if c["id"] == "tts")
    assert tts["configured"] is True
    assert "/korymb-llm" in image["setup"]


def test_mistral_file_ids_from_conversation_payload():
    from tools.media_engines import _mistral_file_ids

    ids = _mistral_file_ids(
        {
            "outputs": [
                {
                    "type": "message.output",
                    "content": [
                        {"type": "text", "text": "Voici l'image."},
                        {"type": "tool_file", "file_id": "file-abc", "file_type": "png", "file_name": "cat.png"},
                    ],
                }
            ]
        }
    )
    assert ids == ["file-abc"]


def test_generate_image_uses_mistral_when_key_present(monkeypatch):
    from tools import media_engines as me

    monkeypatch.setattr(
        me,
        "getenv",
        _fake_getenv({"MEDIA_ENGINE_MODE": "quality", "MISTRAL_API_KEY": "mst-test", "IMAGE_FREE_ENGINE": "0"}),
    )
    png = b"\x89PNG\r\n\x1a\n" + b"z" * 200

    class Conv:
        status_code = 200
        is_success = True

        def json(self):
            return {"outputs": [{"type": "message.output", "content": [{"type": "tool_file", "file_id": "file-1", "file_type": "png"}]}]}

    class FileResp:
        status_code = 200
        is_success = True
        content = png
        headers = {"content-type": "image/png"}

    def fake_post(*a, **k):
        return Conv()

    def fake_get(*a, **k):
        return FileResp()

    monkeypatch.setattr(me.httpx, "post", fake_post)
    monkeypatch.setattr(me.httpx, "get", fake_get)
    monkeypatch.setattr(me, "_save_bytes", lambda *a, **k: "file_id: rfil-mistral (200 octets)")
    token = me.push_media_engine_mode("quality")
    try:
        out = me.generate_image("orange cat")
    finally:
        me.reset_media_engine_mode(token)
    assert out.startswith("✅")
    assert "mistral" in out.lower()
    assert "file_id:" in out
