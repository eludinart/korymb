"""Journal : outils, recherche, citations, mémoire de fin."""
from __future__ import annotations


def test_tool_is_not_run_twice_for_the_same_arguments(app):
    from services.mission_journal import run_tool_once

    calls = {"n": 0}

    def execute() -> str:
        calls["n"] += 1
        return "résultat stable"

    first = run_tool_once("job-journal-1", "web_search", {"q": "elude"}, execute)
    second = run_tool_once("job-journal-1", "web_search", {"q": "elude"}, execute)
    assert first == "résultat stable"
    assert second == "résultat stable"
    assert calls["n"] == 1


def test_search_finds_a_trace_by_kind_and_period(app):
    from database import search_mission_traces
    from services.mission_journal import note_mission, with_citation

    note_mission("job-journal-2", kind="mission_start", agent="commercial", excerpt="bonjour")
    rows = search_mission_traces(job_id="job-journal-2", kind="mission_start", agent="commercial")
    assert len(rows) == 1
    cited = with_citation(rows[0])
    assert cited["citation"]["excerpt"] == "bonjour"
    assert cited["citation"]["span_id"]


def test_closing_a_mission_keeps_span_ids(app):
    from database_memory import append_recent_mission, get_enterprise_memory
    from services.mission_journal import note_mission

    span = note_mission("job-journal-3", kind="mission_done", agent="coordinateur", excerpt="fini")
    append_recent_mission("job-journal-3", "Une mission", "fini", span_ids=[span])
    recent = get_enterprise_memory().get("recent_missions") or []
    assert recent[-1]["job_id"] == "job-journal-3"
    assert span in recent[-1]["span_ids"]
