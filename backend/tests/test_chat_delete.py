"""Suppression chat : une session n'efface pas les autres prompts identiques."""
from __future__ import annotations


def test_delete_one_chat_keeps_same_prompt_in_another_session(client):
    from database import get_job, save_job, upsert_chat_conversation
    from tenant_context import set_tenant_context

    set_tenant_context(workspace_id="ws-default-legacy")
    mission = "Donne-moi 5 priorités concrètes pour aujourd'hui sur Korymb"
    save_job("cht-del-a", "assistant", mission, source="chat", chat_session_id="conv-del-a")
    save_job("cht-del-b", "assistant", mission, source="chat", chat_session_id="conv-del-b")
    upsert_chat_conversation("conv-del-a", title=mission, messages=[{"role": "user", "content": mission}])
    upsert_chat_conversation("conv-del-b", title=mission, messages=[{"role": "user", "content": mission}])

    removed = client.delete("/jobs/cht-del-a")
    assert removed.status_code == 200, removed.text
    assert get_job("cht-del-a") is None
    assert get_job("cht-del-b") is not None

    gone = client.get("/chat/conversations/conv-del-a")
    assert gone.status_code == 404
    still = client.get("/chat/conversations/conv-del-b")
    assert still.status_code == 200


def test_delete_conversation_removes_its_chat_jobs_only(client):
    from database import get_job, save_job, upsert_chat_conversation
    from tenant_context import set_tenant_context

    set_tenant_context(workspace_id="ws-default-legacy")
    mission = "même question"
    save_job("cht-conv-a", "assistant", mission, source="chat", chat_session_id="conv-only-a")
    save_job("cht-conv-b", "assistant", mission, source="chat", chat_session_id="conv-only-b")
    upsert_chat_conversation("conv-only-a", title="A", messages=[{"role": "user", "content": mission}])
    upsert_chat_conversation("conv-only-b", title="B", messages=[{"role": "user", "content": mission}])

    removed = client.delete("/chat/conversations/conv-only-a")
    assert removed.status_code == 200, removed.text
    assert get_job("cht-conv-a") is None
    assert get_job("cht-conv-b") is not None
    assert client.get("/chat/conversations/conv-only-b").status_code == 200
