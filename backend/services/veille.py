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
import time
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

_LAST_AUTO_PROPOSAL_AT: float = 0.0
_AUTO_PROPOSAL_COOLDOWN_S = 6 * 3600

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

def _persist_mission_proposals(task_id: str, proposals: list[dict]) -> list[dict]:
    """Enregistre les propositions en file d'approbation et notifie le dirigeant."""
    from database import create_autonomous_output

    outputs: list[dict] = []
    for proposal in proposals:
        out = create_autonomous_output(
            task_id=task_id,
            output_type="mission_proposal",
            title=proposal.get("title") or "Proposition de mission",
            content=proposal.get("content") or "",
        )
        outputs.append(out)

    if outputs:
        try:
            from services.director_platform import emit_director_notification
            emit_director_notification(
                kind="scheduler_output",
                title=f"{len(outputs)} proposition(s) de mission à valider",
                body="Le CIO a généré de nouvelles missions à approuver.",
                action_url="/administration/approbations",
            )
        except Exception:
            pass
    return outputs


async def maybe_trigger_proposal_after_closure() -> None:
    """Génère 1 proposition après clôture dirigeant (max 1 / 6 h)."""
    global _LAST_AUTO_PROPOSAL_AT
    now = time.time()
    if now - _LAST_AUTO_PROPOSAL_AT < _AUTO_PROPOSAL_COOLDOWN_S:
        return
    _LAST_AUTO_PROPOSAL_AT = now
    try:
        await generate_mission_proposals_now(nb_proposals=1, task_id="after-closure")
    except Exception:
        logger.exception("Proposition auto post-clôture échouée")


async def generate_mission_proposals_now(
    *,
    nb_proposals: int = 3,
    task_id: str = "on-demand",
) -> dict[str, Any]:
    """Génère et persiste des propositions à la demande (hors planning)."""
    task = {"id": task_id, "params": {"nb_proposals": nb_proposals}}
    logger.info("Génération proposals à la demande — %d proposition(s)", nb_proposals)
    loop = asyncio.get_event_loop()
    proposals = await loop.run_in_executor(None, _generate_mission_proposals, nb_proposals, task)
    if not proposals:
        return {"created": 0, "outputs": [], "message": "Aucune proposition générée"}
    outputs = _persist_mission_proposals(task_id, proposals)
    logger.info("Proposals à la demande : %d proposition(s) créée(s)", len(outputs))
    return {"created": len(outputs), "outputs": outputs}


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

    outputs = _persist_mission_proposals(task_id, proposals)
    logger.info("Mission proposals tâche %s : %d proposition(s) créée(s)", task_id, len(outputs))


def _generate_mission_proposals(nb_proposals: int, task: dict) -> list[dict]:
    """Appel LLM synchrone pour générer des propositions de missions."""
    try:
        import json
        from llm_client import llm_turn
        from services.agents import FLEUR_CONTEXT
        from services.proposal_context import build_ecosystem_proposal_context, format_context_for_prompt

        ecosystem = build_ecosystem_proposal_context()
        context_block = format_context_for_prompt(ecosystem)

        prompt = textwrap.dedent(f"""
            Tu es le CIO d'Élude In Art. Propose exactement {nb_proposals} missions concrètes et actionnables
            que ton équipe agentique peut exécuter cette semaine.

            {FLEUR_CONTEXT}

            --- CONTEXTE ÉCOSYSTÈME (entreprise, décisions, fils, historique) ---
            {context_block}
            --- FIN CONTEXTE ---

            Règles impératives :
            1. Au moins 1 proposition doit dériver d'une décision en attente (section 3 : question CIO, clôture,
               HITL, qualité ou apprentissage) — renseigne source_kind et source_job_id en conséquence.
            2. Au moins 1 proposition doit prolonger un fil ou une mission récente (sections 2, 4 ou 5).
            3. Chaque proposition a un agent principal (commercial, community_manager, developpeur, comptable
               ou coordinateur) dans le champ agents.
            4. Missions réalistes, < 30 min d'IA, forte valeur pour Élude In Art.

            Réponds UNIQUEMENT avec un JSON (tableau) :
            [
              {{
                "title": "Titre court",
                "content": "Description détaillée (2-4 phrases)",
                "why_now": "Pourquoi maintenant (1 phrase)",
                "agents": ["commercial"],
                "source_kind": "cio_question",
                "source_job_id": "abc12345",
                "source_label": "Suite à la question CIO sur…",
                "risk_flags": ["hitl_required"],
                "launch_mode": "supervised"
              }}
            ]

            source_kind autorisés : cio_question, closure, hitl, learning, quality, thread, mission_digest, memory
        """).strip()

        result, _, _ = llm_turn(prompt, max_tokens=1800, or_profile="lite", usage_context=f"proposals:{task['id']}")
        result = result.strip()

        start = result.find("[")
        end = result.rfind("]") + 1
        if start == -1 or end == 0:
            return []
        proposals = json.loads(result[start:end])
        if not isinstance(proposals, list):
            return []
        from services.cost_estimate import estimate_mission_cost

        from services.reprise_audit import _is_generic_title

        enriched: list[dict] = []
        for p in proposals[:nb_proposals]:
            if not isinstance(p, dict):
                continue
            title = str(p.get("title") or "").strip()
            mission_text = str(p.get("content") or p.get("title") or "")
            if _is_generic_title(title):
                continue
            agents = p.get("agents") if isinstance(p.get("agents"), list) else ["coordinateur"]
            proposed_by = str(agents[0] if agents else "coordinateur")
            est = estimate_mission_cost(mission=mission_text, agents=agents, mode="cio")
            blob = {
                "description": mission_text,
                "why_now": str(p.get("why_now") or p.get("rationale") or ""),
                "agents": agents,
                "proposed_by_agent": proposed_by,
                "source_kind": str(p.get("source_kind") or ""),
                "source_job_id": str(p.get("source_job_id") or ""),
                "source_label": str(p.get("source_label") or ""),
                "estimated_tokens": est.get("estimated_tokens"),
                "estimated_cost_usd": est.get("estimated_cost_usd"),
                "risk_flags": p.get("risk_flags") if isinstance(p.get("risk_flags"), list) else [],
                "launch_mode": str(p.get("launch_mode") or "supervised"),
            }
            enriched.append({
                "title": title or "Proposition de mission",
                "content": json.dumps(blob, ensure_ascii=False),
            })
        return enriched
    except Exception as exc:
        logger.error("Génération proposals échouée : %s", exc)
        return []
