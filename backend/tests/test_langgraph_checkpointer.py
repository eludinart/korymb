"""La progression d'une mission en pause survit à un autre processus."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, TypedDict


def _pause_graph():
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import interrupt

    from graph.checkpointer import get_checkpointer

    class State(TypedDict, total=False):
        value: str
        answer: str

    def pause(state: State) -> dict[str, Any]:
        resumed = interrupt({"kind": "pause", "value": state.get("value")})
        if isinstance(resumed, dict):
            return {"answer": str(resumed.get("answer") or "")}
        return {"answer": str(resumed)}

    graph = StateGraph(State)
    graph.add_node("pause", pause)
    graph.add_edge(START, "pause")
    graph.add_edge("pause", END)
    return graph.compile(checkpointer=get_checkpointer())


def test_graph_builder_is_not_cached(app):
    from graph.mission_graph import build_mission_graph

    assert not hasattr(build_mission_graph, "cache_info")
    first = build_mission_graph()
    second = build_mission_graph()
    assert first is not second


def test_paused_mission_is_visible_to_another_process(app):
    import database as db
    from langgraph.types import Command

    thread_id = "job-lg-pause-1"
    config = {"configurable": {"thread_id": thread_id}}
    _pause_graph().invoke({"value": "bonjour"}, config)
    snap = _pause_graph().get_state(config)
    assert snap.values.get("value") == "bonjour"
    assert snap.next

    child = r"""
import json, os
from pathlib import Path
os.environ["KORYMB_DB_ENGINE"] = "sqlite"
import database as db
db.DB_ENGINE = "sqlite"
db.DB_PATH = Path(os.environ["KORYMB_TEST_DB"])
from typing import Any, TypedDict
from langgraph.graph import END, START, StateGraph
from graph.checkpointer import get_checkpointer

class State(TypedDict, total=False):
    value: str
    answer: str

def pause(state: State) -> dict[str, Any]:
    return {"answer": "unread"}

graph = StateGraph(State)
graph.add_node("pause", pause)
graph.add_edge(START, "pause")
graph.add_edge("pause", END)
compiled = graph.compile(checkpointer=get_checkpointer())
snap = compiled.get_state({"configurable": {"thread_id": os.environ["KORYMB_THREAD_ID"]}})
print("KORYMB_LG_RESULT " + json.dumps({
    "value": (snap.values or {}).get("value"),
    "next": list(snap.next or ()),
}))
"""
    env = os_env_for_child(db.DB_PATH, thread_id)
    proc = subprocess.run(
        [sys.executable, "-c", child],
        cwd=str(Path(__file__).resolve().parents[1]),
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    line = next(l for l in proc.stdout.splitlines() if l.startswith("KORYMB_LG_RESULT "))
    found = json.loads(line.split(" ", 1)[1])
    assert found["value"] == "bonjour"
    assert "pause" in found["next"]

    resumed = _pause_graph().invoke(Command(resume={"answer": "oui"}), config)
    assert resumed.get("answer") == "oui"
    sidecar = db.DB_PATH.parent / "langgraph_checkpoints.db"
    assert not sidecar.exists()


def test_deleting_a_job_drops_its_progress(app):
    import database as db
    from database import delete_job_cascade, get_conn, save_job

    thread_id = "job-lg-del-1"
    save_job(thread_id, "coordinateur", "Mission pause à oublier", source="test")
    _pause_graph().invoke({"value": "a-effacer"}, {"configurable": {"thread_id": thread_id}})
    assert delete_job_cascade(thread_id) is True
    with get_conn() as conn:
        checkpoints = conn.execute(
            "SELECT COUNT(*) AS c FROM lg_checkpoints WHERE thread_id=?",
            (thread_id,),
        ).fetchone()
        writes = conn.execute(
            "SELECT COUNT(*) AS c FROM lg_checkpoint_writes WHERE thread_id=?",
            (thread_id,),
        ).fetchone()
    checkpoint_count = int(dict(checkpoints).get("c") if isinstance(checkpoints, dict) else checkpoints[0])
    write_count = int(dict(writes).get("c") if isinstance(writes, dict) else writes[0])
    assert checkpoint_count == 0
    assert write_count == 0
    assert not (db.DB_PATH.parent / "langgraph_checkpoints.db").exists()


def os_env_for_child(db_path: Path, thread_id: str) -> dict[str, str]:
    import os

    env = os.environ.copy()
    backend = str(Path(__file__).resolve().parents[1])
    env["KORYMB_DB_ENGINE"] = "sqlite"
    env["KORYMB_TEST_DB"] = str(db_path)
    env["KORYMB_THREAD_ID"] = thread_id
    env["ENV"] = "test"
    env["PYTHONPATH"] = backend + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    return env
