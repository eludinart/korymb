"""
services/veille.py — Service de veille autonome.

Modes supportés :
  - veille   : recherche DuckDuckGo + RSS sur des thèmes configurables,
               synthèse LLM, stockage dans autonomous_outputs (status=pending).
  - mission_proposals : analyse des missions récentes + mémoire entreprise,
                        génère des propositions de missions à valider.
"""
from __future__ import annotations

import asyncio
import logging
import textwrap
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# ── Helpers RSS ────────────────────────────────────────────────────────────────

def _fetch_rss_headlines(feed_url: str, max_items: int = 5) -> list[str]:
    """Retourne les titres + résumés des dernières entrées d'un flux RSS."""
    try:
        import feedparser
        feed = feedparser.parse(feed_url)
        items: list[str] = []
        for entry in feed.entries[:max_items]:
            title = getattr(entry, "title", "")
            summary = getattr(entry, "summary", "")[:300]
            items.append(f"- {title} : {summary}")
        return items
    except Exception as exc:
        logger.warning("RSS fetch échoué (%s) : %s", feed_url, exc)
        return []


def _ddg_search(query: str, max_results: int = 5) -> list[str]:
    """Recherche DuckDuckGo — retourne titre + URL."""
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                snippet = (r.get("body") or "")[:300]
                results.append(f"- {r.get('title', '')} ({r.get('href', '')})\n  {snippet}")
        return results
    except Exception as exc:
        logger.warning("DuckDuckGo search échoué (%s) : %s", query, exc)
        return []


# ── Veille principale ──────────────────────────────────────────────────────────

async def run_veille_task(task: dict) -> None:
    """
    Tâche de veille : collecte web (DDG + RSS) sur les thèmes configurés,
    synthétise via LLM, crée un autonomous_output (type=veille_summary ou article).
    """
    task_id = task["id"]
    params = task.get("params") or {}
    topics: list[str] = params.get("topics") or ["bien-être émotionnel", "spiritualité", "tarot"]
    rss_feeds: list[str] = params.get("rss_feeds") or []
    max_results_per_topic: int = int(params.get("max_results_per_topic") or 5)
    output_type: str = params.get("output_type") or "veille_summary"

    logger.info("Veille démarrée — tâche %s, %d thème(s)", task_id, len(topics))

    loop = asyncio.get_event_loop()
    raw_lines: list[str] = []

    # Recherches DuckDuckGo en parallèle (via executor car DDGS est sync)
    ddg_coros = [
        loop.run_in_executor(None, _ddg_search, topic, max_results_per_topic)
        for topic in topics
    ]
    rss_coros = [
        loop.run_in_executor(None, _fetch_rss_headlines, url, 5)
        for url in rss_feeds
    ]
    all_results = await asyncio.gather(*ddg_coros, *rss_coros, return_exceptions=True)

    for i, topic in enumerate(topics):
        result = all_results[i]
        if isinstance(result, Exception):
            continue
        raw_lines.append(f"\n### Thème : {topic}")
        raw_lines.extend(result or ["(aucun résultat)"])

    for j, url in enumerate(rss_feeds):
        result = all_results[len(topics) + j]
        if isinstance(result, Exception):
            continue
        raw_lines.append(f"\n### Flux RSS : {url}")
        raw_lines.extend(result or ["(aucun résultat)"])

    if not raw_lines:
        logger.warning("Veille tâche %s : aucune donnée collectée", task_id)
        return

    raw_text = "\n".join(raw_lines)[:8000]

    # Synthèse LLM
    synthesis = await loop.run_in_executor(None, _synthesize_veille, raw_text, topics, task)
    if not synthesis:
        logger.warning("Veille tâche %s : synthèse LLM vide", task_id)
        return

    # Stockage dans autonomous_outputs
    from database import create_autonomous_output
    today = datetime.utcnow().strftime("%d/%m/%Y")
    title = f"Veille {', '.join(topics[:2])} — {today}"
    create_autonomous_output(
        task_id=task_id,
        output_type=output_type,
        title=title,
        content=synthesis,
    )
    logger.info("Veille tâche %s : output créé (%s)", task_id, output_type)


def _synthesize_veille(raw_text: str, topics: list[str], task: dict) -> str:
    """Appel LLM synchrone pour synthétiser les résultats de veille."""
    try:
        from llm_client import llm_turn
        from services.agents import FLEUR_CONTEXT

        topic_list = ", ".join(topics)
        mission_template = str(task.get("mission_template") or "").strip()
        extra_instruction = f"\nInstructions spécifiques : {mission_template}" if mission_template else ""

        prompt = textwrap.dedent(f"""
            Tu es le CIO d'Élude In Art. Tu viens de collecter les informations suivantes
            sur les thèmes : {topic_list}.

            ---
            {raw_text}
            ---

            {FLEUR_CONTEXT}

            Ta mission : produire une synthèse de veille structurée avec :
            1. Les 3-5 tendances ou sujets les plus pertinents pour Élude In Art
            2. Des insights actionnables (contenu à créer, sujets à aborder en consultation, messages clés)
            3. Si pertinent, une ébauche d'article de blog ou de post réseaux sociaux prêt à adapter{extra_instruction}

            Format : markdown structuré, ton professionnel et bienveillant, aligné avec le positionnement d'Élude In Art.
        """).strip()

        result, _, _ = llm_turn(prompt, max_tokens=2000, or_profile="lite", usage_context=f"veille:{task['id']}")
        return result.strip()
    except Exception as exc:
        logger.error("Synthèse LLM veille échouée : %s", exc)
        return ""


# ── Mission proposals ──────────────────────────────────────────────────────────

async def run_mission_proposals_task(task: dict) -> None:
    """
    Analyse les missions récentes et la mémoire entreprise pour générer
    des propositions de missions autonomes à valider.
    """
    task_id = task["id"]
    params = task.get("params") or {}
    nb_proposals = int(params.get("nb_proposals") or 3)

    logger.info("Mission proposals démarrée — tâche %s", task_id)
    loop = asyncio.get_event_loop()
    proposals = await loop.run_in_executor(None, _generate_mission_proposals, nb_proposals, task)

    if not proposals:
        logger.warning("Mission proposals tâche %s : aucune proposition générée", task_id)
        return

    from database import create_autonomous_output
    for proposal in proposals:
        create_autonomous_output(
            task_id=task_id,
            output_type="mission_proposal",
            title=proposal.get("title") or "Proposition de mission",
            content=proposal.get("content") or "",
        )
    logger.info("Mission proposals tâche %s : %d proposition(s) créée(s)", task_id, len(proposals))


def _generate_mission_proposals(nb_proposals: int, task: dict) -> list[dict]:
    """Appel LLM synchrone pour générer des propositions de missions."""
    try:
        import json
        from llm_client import llm_turn
        from services.agents import FLEUR_CONTEXT
        from database import list_jobs_prompt_digest, get_enterprise_memory

        jobs_digest = list_jobs_prompt_digest(limit=10)
        memory = get_enterprise_memory()
        contexts = memory.get("contexts") or {}
        memory_text = "\n".join(f"- {k}: {v}" for k, v in contexts.items())[:2000] if contexts else "(vide)"

        recent_missions_text = "\n".join(
            f"- [{j.get('agent','')}] {(j.get('mission') or '')[:120]}"
            for j in jobs_digest[:8]
        ) or "(aucune)"

        prompt = textwrap.dedent(f"""
            Tu es le CIO d'Élude In Art. En tant qu'agent stratégique, propose {nb_proposals} missions
            concrètes et actionnables que tu pourrais exécuter de façon autonome cette semaine.

            {FLEUR_CONTEXT}

            Mémoire entreprise actuelle :
            {memory_text}

            Missions récentes réalisées :
            {recent_missions_text}

            Génère exactement {nb_proposals} propositions au format JSON :
            [
              {{
                "title": "Titre court de la mission",
                "content": "Description détaillée de la mission, objectifs, livrables attendus (2-4 phrases)"
              }}
            ]

            Critères : missions réalistes, à forte valeur ajoutée pour Élude In Art,
            exécutables en moins de 30 minutes d'IA. Réponds UNIQUEMENT avec le JSON, sans markdown.
        """).strip()

        result, _, _ = llm_turn(prompt, max_tokens=1200, or_profile="lite", usage_context=f"proposals:{task['id']}")
        result = result.strip()

        # Extraction JSON robuste
        start = result.find("[")
        end = result.rfind("]") + 1
        if start == -1 or end == 0:
            return []
        proposals = json.loads(result[start:end])
        return proposals[:nb_proposals] if isinstance(proposals, list) else []
    except Exception as exc:
        logger.error("Génération proposals échouée : %s", exc)
        return []
