"""
crew.py — Construction des crews (mode séquentiel).

Note : le mode hiérarchique CrewAI est incompatible avec Claude (bug tool_use/tool_result).
Tous les agents tournent en séquentiel. Le CIO utilise ses outils et sa connaissance directement.
"""
import logging
import re
from crewai import Crew, Task, Process
from agents import AGENTS
from config import settings


class _JobLogHandler(logging.Handler):
    """Capture les logs Python ET les tokens de consommation."""

    def __init__(self, job_logs: list, token_counter: dict):
        super().__init__()
        self.job_logs = job_logs
        self.token_counter = token_counter

    def emit(self, record: logging.LogRecord):
        try:
            msg = record.getMessage()
            if not msg.strip():
                return

            # Extraction tokens
            if "input_tokens" in msg:
                m_in  = re.search(r"input_tokens['\": ]+(\d+)", msg)
                m_out = re.search(r"output_tokens['\": ]+(\d+)", msg)
                if m_in:
                    self.token_counter["in"]  += int(m_in.group(1))
                if m_out:
                    self.token_counter["out"] += int(m_out.group(1))

            self.job_logs.append(msg[:500])

        except Exception:
            pass


_WATCHED = ["crewai", "langchain", "langchain_core", "langchain_anthropic", "httpx", "root"]


def build_crew(
    mission: str,
    agent_key: str,
    job_logs: list,
    token_counter: dict,
    context: dict | None = None,
) -> Crew:
    context_str = f"\nContexte additionnel : {context}" if context else ""
    full_mission = f"{mission}{context_str}"

    handler = _JobLogHandler(job_logs, token_counter)
    handler.setLevel(logging.DEBUG)
    watched = [logging.getLogger(n) for n in _WATCHED]
    for lg in watched:
        lg.addHandler(handler)
        lg.setLevel(logging.DEBUG)

    def on_task_done(output):
        try:
            job_logs.append(f"✓ Tâche terminée : {str(output.raw)[:400]}")
        except Exception:
            pass

    if True:  # tous les agents en mode séquentiel direct
        agent = AGENTS.get(agent_key) or AGENTS["coordinateur"]
        task = Task(
            description=full_mission,
            expected_output="Un livrable clair, structuré et actionnable.",
            agent=agent,
            callback=on_task_done,
        )
        crew = Crew(
            agents=[agent],
            tasks=[task],
            process=Process.sequential,
            verbose=False,
            memory=False,
        )

    crew._korymb_cleanup = lambda: [lg.removeHandler(handler) for lg in watched]
    return crew
