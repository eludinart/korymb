"""
services/triad_orchestrator.py — Orchestration multi-agent hiérarchique : Architect → Executor → Critic.

La triade remplace orchestrate_coordinateur_mission quand mission_config["mode"] == "triad".

Rôles :
- Architect  (SYST, temp=0.7) : analyse + plan Chain-of-Thought
- Executor   (TECH, temp=0.2) : production technique du livrable
- Critic     (SYST, temp=0.7) : validation + Avocat du Diable (1 retry si rejeté)

Règle d'Or : ne supprime aucune fonctionnalité existante, encapsule-les.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable

from config import TEMP_TECH, TEMP_SYST
from llm_client import llm_turn
from agent_tool_use import llm_turn_maybe_tools

logger = logging.getLogger(__name__)

ToolEmitFn = Callable[[str, str, dict[str, Any]], None]

# Outils autorisés par défaut pour l'Exécuteur dans la triade
_EXECUTOR_DEFAULT_TOOL_TAGS: list[str] = ["web", "knowledge", "validate"]

# ── System prompts des trois rôles ────────────────────────────────────────────

_ARCHITECT_SYSTEM = """Tu es l'Architecte de KORYMB — rôle PLANIFICATEUR.

Tu reçois une mission et tu produis un plan d'action structuré (Chain-of-Thought) :
1. Analyse de la mission : intention réelle, contraintes, critères de succès.
2. Sélection des outils et ressources nécessaires (web, knowledge, validate, etc.).
3. Décomposition en étapes séquentielles claires pour l'Exécuteur.
4. Identification des risques, angles morts, et points de vigilance.
5. Instructions précises pour l'Exécuteur.

Format de sortie :
## Analyse
[...]
## Plan d'action
1. [...]
2. [...]
## Outils requis
[...]
## Points de vigilance
[...]
## Consigne Exécuteur
[...]
"""

_EXECUTOR_SYSTEM = """Tu es l'Exécuteur de KORYMB — rôle TECHNIQUE.

Tu reçois le plan de l'Architecte et la mission originale. Tu produis le livrable :
- Code : propre, commenté, testé mentalement.
- Analyse : structurée, sourcée, actionnelle.
- Rédaction : dense, sans remplissage, orientée résultat.

Règles strictes :
- Suis le plan de l'Architecte à la lettre.
- Utilise les outils disponibles pour les données factuelles (ne pas inventer).
- Cite les sources implicites.
- Livre du concret, pas de la prose vague.
"""

_CRITIC_SYSTEM = """Tu es le Critique de KORYMB — l'Avocat du Diable.

Tu analyses le livrable de l'Exécuteur avec un regard implacable. Cherche :
1. Les angles morts factuels (informations manquantes, non vérifiées).
2. Les incohérences logiques (contradictions internes, raisonnements défaillants).
3. Le désalignement avec les valeurs de Sivana : authenticité, ancrage terrain, capacité réelle.
4. Les propositions "légères" : génériques, déconnectées, non actionnables.

Réponds UNIQUEMENT en JSON valide (pas de markdown autour) :
{
  "rejected": true/false,
  "alignment_score": 0-10,
  "critique": "analyse des problèmes trouvés",
  "feedback": "instructions précises pour corriger (vide si approved)",
  "approved_sections": ["liste des parties validées"]
}

Si rejected=false et alignment_score >= 7 : le livrable est validé.
Sois rigoureux mais juste : ne rejette pas pour des raisons stylistiques.
"""


# ── Parseur verdict Critique ───────────────────────────────────────────────────

def _parse_critic_verdict(raw: str) -> dict[str, Any]:
    """Extrait le JSON du verdict Critique depuis la réponse brute."""
    text = (raw or "").strip()
    # Cherche le premier bloc JSON valide
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
    # Fallback: texte heuristique
    rejected = any(kw in text.lower() for kw in ("rejected: true", '"rejected": true', "rejet", "insuffisant"))
    return {
        "rejected": rejected,
        "alignment_score": 5 if not rejected else 3,
        "critique": text[:1000],
        "feedback": text[:600] if rejected else "",
        "approved_sections": [],
    }


# ── Orchestrateur principal ───────────────────────────────────────────────────

def orchestrate_triad(
    mission_text: str,
    mission_plain: str,
    job_logs: list[str],
    *,
    job_id: str | None = None,
    tool_tags: list[str] | None = None,
    on_tool: ToolEmitFn | None = None,
    fleur_context: str = "",
    memory_context: str = "",
    max_critic_retries: int = 1,
) -> tuple[str, int, int]:
    """
    Exécute la triade Architect → Executor → Critic.

    Returns:
        (result_text, total_tokens_in, total_tokens_out)
    """
    t_in_total = t_out_total = 0
    effective_tool_tags = tool_tags if tool_tags is not None else _EXECUTOR_DEFAULT_TOOL_TAGS

    # Contexte commun injecté
    context_prefix = ""
    if fleur_context:
        context_prefix += f"\n\n{fleur_context}"
    if memory_context:
        context_prefix += f"\n\n{memory_context}"

    # ── Phase 1 : Architect ───────────────────────────────────────────────────
    job_logs.append("[triad:architect] Analyse de la mission et planification...")
    architect_system = _ARCHITECT_SYSTEM + context_prefix
    try:
        architect_plan, ti, to = llm_turn(
            architect_system,
            f"Mission à planifier :\n\n{mission_text}",
            max_tokens=2048,
            or_profile="standard",
            usage_job_id=job_id,
            usage_context="triad:architect",
            temperature=TEMP_SYST,
        )
        t_in_total += ti
        t_out_total += to
        job_logs.append(f"[triad:architect] Plan produit ({ti}↑ {to}↓ tokens).")
    except Exception as exc:
        logger.exception("triad:architect failed")
        job_logs.append(f"[triad:architect] Erreur planification : {exc}")
        architect_plan = f"Exécuter directement la mission suivante :\n{mission_plain}"

    # ── Phase 2 : Executor ────────────────────────────────────────────────────
    job_logs.append("[triad:executor] Production du livrable...")
    executor_system = _EXECUTOR_SYSTEM + context_prefix
    executor_prompt = (
        f"## Plan de l'Architecte\n\n{architect_plan}\n\n"
        f"## Mission originale\n\n{mission_text}"
    )

    def on_tool_executor(actor: str, tool_name: str, meta: dict[str, Any]) -> None:
        job_logs.append(f"[triad:executor:tool] {tool_name}")
        if on_tool:
            on_tool(actor or "executor", tool_name, meta)

    try:
        executor_result, ti, to = llm_turn_maybe_tools(
            executor_system,
            executor_prompt,
            effective_tool_tags,
            job_logs,
            max_tokens=4096,
            on_tool=on_tool_executor,
            tool_actor="executor",
            usage_job_id=job_id,
            usage_context="triad:executor",
            temperature=TEMP_TECH,
        )
        t_in_total += ti
        t_out_total += to
        job_logs.append(f"[triad:executor] Livrable produit ({ti}↑ {to}↓ tokens).")
    except Exception as exc:
        logger.exception("triad:executor failed")
        job_logs.append(f"[triad:executor] Erreur exécution : {exc}")
        return f"Erreur Executor : {exc}", t_in_total, t_out_total

    # ── Phase 3 : Critic (avec 1 retry si rejeté) ─────────────────────────────
    job_logs.append("[triad:critic] Validation du livrable...")
    critic_system = _CRITIC_SYSTEM + context_prefix
    final_result = executor_result
    retries_done = 0

    for attempt in range(max_critic_retries + 1):
        critic_prompt = (
            f"## Mission originale\n\n{mission_plain}\n\n"
            f"## Plan de l'Architecte\n\n{architect_plan}\n\n"
            f"## Livrable de l'Exécuteur\n\n{final_result}"
        )
        try:
            verdict_raw, ti, to = llm_turn(
                critic_system,
                critic_prompt,
                max_tokens=1024,
                or_profile="lite",
                usage_job_id=job_id,
                usage_context=f"triad:critic:{attempt}",
                temperature=TEMP_SYST,
            )
            t_in_total += ti
            t_out_total += to
        except Exception as exc:
            logger.exception("triad:critic failed")
            job_logs.append(f"[triad:critic] Erreur validation : {exc} — livrable accepté par défaut.")
            break

        verdict = _parse_critic_verdict(verdict_raw)
        score = verdict.get("alignment_score", 5)
        job_logs.append(
            f"[triad:critic] Score d'alignement : {score}/10 — "
            f"{'REJETÉ' if verdict['rejected'] else 'VALIDÉ'} ({ti}↑ {to}↓ tokens)."
        )

        if not verdict["rejected"] or attempt >= max_critic_retries:
            if verdict["critique"]:
                # Annexer la critique Critic au livrable pour transparence
                critique_annex = (
                    f"\n\n---\n*Validation Critique (score {score}/10)*\n"
                    f"*{verdict['critique'][:500]}*"
                )
                final_result = final_result + critique_annex
            break

        # Retry Executor avec le feedback du Critic
        retries_done += 1
        job_logs.append(
            f"[triad:critic→executor] Livrable rejeté (score {score}/10). "
            f"Retry Executor avec feedback (essai {retries_done}/{max_critic_retries})."
        )
        retry_prompt = (
            f"## Mission originale\n\n{mission_text}\n\n"
            f"## Plan de l'Architecte\n\n{architect_plan}\n\n"
            f"## Ton livrable précédent (insuffisant)\n\n{final_result}\n\n"
            f"## Feedback du Critique\n\n{verdict['feedback']}\n\n"
            "Corrige les points identifiés par le Critique et produis une version améliorée."
        )
        try:
            final_result, ti, to = llm_turn_maybe_tools(
                executor_system,
                retry_prompt,
                effective_tool_tags,
                job_logs,
                max_tokens=4096,
                on_tool=on_tool_executor,
                tool_actor="executor",
                usage_job_id=job_id,
                usage_context=f"triad:executor:retry:{retries_done}",
                temperature=TEMP_TECH,
            )
            t_in_total += ti
            t_out_total += to
            job_logs.append(f"[triad:executor:retry] Livrable révisé ({ti}↑ {to}↓ tokens).")
        except Exception as exc:
            logger.exception("triad:executor retry failed")
            job_logs.append(f"[triad:executor:retry] Erreur : {exc} — livrable précédent conservé.")
            break

    job_logs.append(
        f"[triad] Mission terminée — {t_in_total}↑ {t_out_total}↓ tokens total. "
        f"{retries_done} retry(s) Executor."
    )
    return final_result, t_in_total, t_out_total
