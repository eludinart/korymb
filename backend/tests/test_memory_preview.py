"""Preview mémoire — forme attendue par la console admin."""


def test_memory_preview_returns_prompt_and_agents_map(client):
    r = client.get("/memory/preview?agent_key=coordinateur")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("agent_key") == "coordinateur"
    assert isinstance(body.get("prompt"), str)
    assert len(body["prompt"]) > 0
    assert "coordinateur" in (body.get("agents") or {})
    assert body["agents"]["coordinateur"] == body["prompt"]


def test_memory_preview_respects_agent_group_scope(client, app):
    from database import merge_enterprise_contexts, upsert_agent_group
    from services import agent_groups as ag

    ag.ensure_enterprise_group()
    marker = "PREVIEW-SCIENCE-MARKER-WW2"
    merge_enterprise_contexts({"global": f"Workspace ops {marker}"})
    gid = "grp_preview_iso"
    upsert_agent_group(
        gid,
        slug="preview_iso",
        label="Preview isolé",
        description="mission dédiée",
        status="active",
        lead_agent_key="coordinateur",
        member_keys=["commercial"],
        policy={**ag.default_group_policy(), "memory_scope": "group"},
        is_system=False,
        template_key=None,
    )

    enterprise = client.get("/memory/preview?agent_key=coordinateur")
    assert enterprise.status_code == 200, enterprise.text
    assert marker in enterprise.json()["prompt"]

    scoped = client.get(f"/memory/preview?agent_key=coordinateur&agent_group_id={gid}")
    assert scoped.status_code == 200, scoped.text
    prompt = scoped.json()["prompt"]
    assert marker not in prompt
    assert "Reste strictement sur la consigne" in prompt
