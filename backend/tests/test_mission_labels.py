from services.mission_labels import clip_mission_title, resolve_mission_id_refs_in_text


def test_clip_mission_title():
    assert clip_mission_title("  Programme été 2026  ", 20) == "Programme été 2026"
    assert clip_mission_title("x" * 200, 10) == "xxxxxxxxx…"


def test_resolve_mission_id_refs_passthrough_when_unknown(monkeypatch):
    monkeypatch.setattr(
        "services.mission_labels._title_for_job_id",
        lambda jid, cache: "",
    )
    text = "Voir Mission #6b2ba594 pour le détail."
    assert resolve_mission_id_refs_in_text(text) == text


def test_resolve_mission_id_refs_replaces_known_id(monkeypatch):
    def fake_title(jid: str, cache: dict[str, str]) -> str:
        cache[jid] = "Programme Stratégique d'Été 2026"
        return cache[jid]

    monkeypatch.setattr("services.mission_labels._title_for_job_id", fake_title)
    out = resolve_mission_id_refs_in_text("D'après Mission #6b2ba594, voici la suite.")
    assert "6b2ba594" not in out
    assert "Programme Stratégique" in out
