"""Construction du StateGraph mission."""
from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from graph.checkpointer import get_checkpointer
from graph.mission_state import MissionGraphState
from graph.nodes.mission_nodes import (
    node_init,
    node_run_cio,
    node_run_single,
    node_run_triad,
    route_by_mode,
)


@lru_cache(maxsize=1)
def build_mission_graph():
    g = StateGraph(MissionGraphState)
    g.add_node("init", node_init)
    g.add_node("run_cio", node_run_cio)
    g.add_node("run_triad", node_run_triad)
    g.add_node("run_single", node_run_single)

    g.add_edge(START, "init")
    g.add_conditional_edges("init", route_by_mode, {
        "cio": "run_cio",
        "triad": "run_triad",
        "single": "run_single",
    })
    g.add_edge("run_cio", END)
    g.add_edge("run_triad", END)
    g.add_edge("run_single", END)

    return g.compile(checkpointer=get_checkpointer())
