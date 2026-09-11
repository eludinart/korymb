"""Contrats API prompts d'orchestration (plan CIO + synthèses)."""
from __future__ import annotations

KEYS = (
    "cio_plan_json_user",
    "cio_synthesis_with_team_user",
    "cio_synthesis_solo_suffix",
)


def test_orchestration_prompts_list_includes_bodies(client):
    r = client.get("/admin/orchestration-prompts")
    assert r.status_code == 200, r.text
    prompts = r.json()["prompts"]
    assert [p["prompt_key"] for p in prompts] == list(KEYS)
    solo = next(p for p in prompts if p["prompt_key"] == "cio_synthesis_solo_suffix")
    assert "QUESTIONS STRATEGIQUES" in (solo.get("body") or "")
    assert int(solo.get("body_chars") or 0) > 20


def test_orchestration_prompts_get_each_key(client):
    for key in KEYS:
        r = client.get(f"/admin/orchestration-prompts/{key}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["prompt_key"] == key
        assert len(body.get("body") or "") > 20


def test_orchestration_prompts_get_unknown_key(client):
    r = client.get("/admin/orchestration-prompts/not_a_real_prompt")
    assert r.status_code == 400
