"""
services/quality_gate.py — Quality gate générique par sous-agent.

Généralisation du pattern Critic de la Triade (services/triad_orchestrator.py) :
un Critique LLM (palier lite) évalue le livrable d'un sous-agent, et si le verdict
est « rejeté » (score < seuil), un unique retry avec feedback est tenté.

Le gate est tolérant aux pannes : toute erreur interne accepte le livrable tel quel
(jamais de blocage de mission à cause du contrôle qualité).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

ToolEmitFn = Callable[[str, str, dict[str, Any]], None]

CRITIC_SYSTEM = """Tu es le Critique qualité de KORYMB — l'Avocat du Diable.

Tu analyses le livrable d'un agent métier avec un regard implacable. Cherche :
1. Les angles morts factuels (informations manquantes, non vérifiées, inventées).
2. Les incohérences logiques (contradictions internes, raisonnements défaillants).
3. Le hors-sujet par rapport à la consigne reçue.
4. Les propositions « légères » : génériques, déconnectées, non actionnables.

Réponds UNIQUEMENT en JSON valide (pas de markdown autour) :
{
  "rejected": true/false,
  "alignment_score": 0-10,
  "critique": "analyse des problèmes trouvés",
  "feedback": "instructions précises pour corriger (vide si approuvé)"
}

Sois rigoureux mais juste : ne rejette pas pour des raisons stylistiques.
"""


def parse_critic_verdict(raw: str) -> dict[str, Any]:
    """Extrait le JSON du verdict Critique depuis la réponse brute (avec fallback heuristique)."""
    text = (raw or "").strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        candidate = text[start:end]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return {
                    "rejected": bool(parsed.get("rejected", False)),
                    "alignment_score": int(parsed.get("alignment_score") or 0),
                    "critique": str(parsed.get("critique") or ""),
                    "feedback": str(parsed.get("feedback") or ""),
                    "approved_sections": list(parsed.get("approved_sections") or []),
                }
        except (json.JSONDecodeError, ValueError):
            pass
    rejected = any(kw in text.lower() for kw in ("rejected: true", '"rejected": true', "rejet", "insuffisant"))
    return {
        "rejected": rejected,
        "alignment_score": 5 if not rejected else 3,
        "critique": text[:1000],
        "feedback": text[:600] if rejected else "",
        "approved_sections": [],
    }


def run_subagent_quality_gate(
    agent_key: str,
    agent_label: str,
    tache: str,
    result_text: str,
    agent_system: str,
    tool_tags: list[str] | None,
    job_logs: list[str] | None,
    *,
    job_id: str | None = None,
    on_tool: ToolEmitFn | None = None,
    min_score: int = 6,
    usage_context_prefix: str = "quality_gate",
) -> tuple[str, int, int, dict[str, Any]]:
    """
    Évalue le livrable d'un sous-agent et retente une fois si rejeté.

    Returns:
        (final_text, tokens_in, tokens_out, verdict)
    """
    from llm_client import llm_turn
    from agent_tool_use import llm_turn_maybe_tools

    t_in = t_out = 0
    final_text = result_text

    def log(msg: str) -> None:
        if job_logs is not None:
            job_logs.append(msg)

    critic_prompt = (
        f"## Consigne reçue par l'agent ({agent_label})\n\n{tache}\n\n"
        f"## Livrable de l'agent\n\n{result_text}"
    )
    try:
        verdict_raw, ti, to = llm_turn(
            CRITIC_SYSTEM,
            critic_prompt,
            max_tokens=1024,
            or_profile="lite",
            usage_job_id=job_id,
            usage_context=f"{usage_context_prefix}:critic:{agent_key}",
        )
        t_in += ti
        t_out += to
    except Exception as exc:
        logger.warning("quality gate critic failed for %s : %s", agent_key, exc)
        log(f"[korymb] Quality gate {agent_label} : critique indisponible ({exc}) — livrable accepté.")
        return final_text, t_in, t_out, {"rejected": False, "alignment_score": -1, "critique": "", "feedback": ""}

    verdict = parse_critic_verdict(verdict_raw)
    score = int(verdict.get("alignment_score") or 0)
    rejected = bool(verdict.get("rejected")) or (0 <= score < min_score)
    verdict["rejected"] = rejected
    log(
        f"[korymb] Quality gate {agent_label} : score {score}/10 — "
        f"{'REJETÉ (retry)' if rejected else 'validé'}."
    )

    if not rejected:
        return final_text, t_in, t_out, verdict

    retry_prompt = (
        f"## Consigne initiale\n\n{tache}\n\n"
        f"## Ton livrable précédent (jugé insuffisant par le contrôle qualité)\n\n{result_text}\n\n"
        f"## Feedback du Critique qualité\n\n{verdict.get('feedback') or verdict.get('critique') or ''}\n\n"
        "Corrige les points identifiés et produis une version améliorée, complète et actionnable."
    )
    try:
        revised, ti2, to2 = llm_turn_maybe_tools(
            agent_system,
            retry_prompt,
            tool_tags,
            job_logs,
            on_tool=on_tool,
            tool_actor=agent_key,
            usage_job_id=job_id,
            usage_context=f"{usage_context_prefix}:retry:{agent_key}",
        )
        t_in += ti2
        t_out += to2
        if (revised or "").strip():
            final_text = revised
            log(f"[korymb] Quality gate {agent_label} : livrable révisé après feedback.")
    except Exception as exc:
        logger.warning("quality gate retry failed for %s : %s", agent_key, exc)
        log(f"[korymb] Quality gate {agent_label} : retry impossible ({exc}) — livrable initial conservé.")

    return final_text, t_in, t_out, verdict
