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
