"""
crew.py — Construction des crews.

- Mode "agent direct" : un seul agent exécute la tâche.
- Mode "CIO orchestrateur" : le CIO dispatche aux autres agents (Process.hierarchical).
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

    # ── Mode CIO orchestrateur ──────────────────────────────────────────────
    if agent_key == "coordinateur":
        from crewai import Agent, LLM
        from config import settings as s

        # Le manager en mode hiérarchique NE DOIT PAS avoir d'outils
        manager_llm = LLM(
            model=f"anthropic/{s.anthropic_model}",
            api_key=s.anthropic_api_key,
            temperature=0.3,
        )
        manager = Agent(
            role=AGENTS["coordinateur"].role,
            goal=AGENTS["coordinateur"].goal,
            backstory=AGENTS["coordinateur"].backstory,
            llm=manager_llm,
            verbose=False,
            allow_delegation=True,
        )

        workers = [
            AGENTS["commercial"],
            AGENTS["community_manager"],
            AGENTS["developpeur"],
            AGENTS["comptable"],
        ]

        task = Task(
            description=(
                f"{full_mission}\n\n"
                "En tant que CIO, analyse la demande et délègue les sous-tâches "
                "aux agents appropriés (Commercial, Community Manager, Développeur, Comptable). "
                "Synthétise ensuite leurs résultats en un livrable final structuré."
            ),
            expected_output="Un rapport complet avec les contributions de chaque agent mobilisé et une synthèse décisionnelle.",
            agent=manager,
            callback=on_task_done,
        )

        crew = Crew(
            agents=workers,
            tasks=[task],
            manager_agent=manager,
            process=Process.hierarchical,
            verbose=False,
            memory=False,
        )

    # ── Mode agent direct ───────────────────────────────────────────────────
    else:
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
