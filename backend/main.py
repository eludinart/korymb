"""
main.py — Korymb Backend v3 — LLM via Anthropic direct ou OpenRouter (config .env), sans CrewAI dans le flux.
"""
import json
import asyncio
import logging
import re
import os
import sys
import time
import socket
import platform
import shutil
import unicodedata
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import date, datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Garantit la disponibilité des variables backend/.env pour les sondes admin
# (facebook/instagram/smtp/drive) qui lisent os.getenv directement.
# override=True : le fichier backend/.env reste la source de vérité.
load_dotenv(Path(__file__).resolve().with_name(".env"), override=True)

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field

from config import settings
from version import BACKEND_REVISION_AT, BACKEND_VERSION

_KORYMB_BACKEND_DIR = Path(__file__).resolve().parent
from database import (
    init_db,
    save_job,
    update_job,
    get_job as db_get_job,
    list_jobs as db_list_jobs,
    sum_jobs_tokens_total,
    job_set_user_validated,
    create_mission_session,
    get_mission_session,
    list_mission_sessions,
    append_session_message,
    mission_session_commit,
    delete_mission_session,
    get_enterprise_memory,
    merge_enterprise_contexts,
    append_recent_mission,
    append_job_mission_thread,
    list_jobs_prompt_digest,
    usage_cost_breakdown,
    usage_events_exist,
    fetch_custom_agents_definitions_merge_shape,
    upsert_custom_agent,
    delete_custom_agent,
    validate_custom_agent_key,
    ALLOWED_AGENT_TOOL_TAGS,
)
from agent_tool_use import llm_chat_maybe_tools, llm_turn_maybe_tools
from observability import make_event
from llm_client import llm_turn, llm_chat
from llm_tiers import resolve_openrouter_tier, tier_config_public
from runtime_settings import merge_with_env, save_partial, to_public_dict
from debug_ndjson import append_session_ndjson

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s — %(message)s")
logger = logging.getLogger(__name__)
_PROCESS_STARTED_AT = time.time()


def _cio_ndjson_trace(
    run_id: str,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict | None = None,
) -> None:
    # region agent log
    append_session_ndjson(run_id, hypothesis_id, location, message, data)
    # endregion


# ── Définitions des agents intégrés (fusionnées à l'exécution avec SQLite custom_agents) ──
BUILTIN_AGENT_DEFINITIONS = {
    "commercial": {
        "label": "Commercial",
        "role": "Prospection & emails",
        "tools": ["web", "linkedin", "email", "drive"],
        "system": (
            "Tu es le Commercial d'Élude In Art. Tu es expert en prospection et développement commercial "
            "pour le Tarot Fleur d'ÅmÔurs. Tu privilégies l'approche maïeutique : tu ouvres des espaces "
            "de sens plutôt que de forcer une vente. Ton public cible : coachs, thérapeutes, facilitateurs.\n"
            "Tu disposes d'outils (recherche web, pages publiques, recherche LinkedIn publique, brouillon d'email). "
            "Dès qu'on te demande des pistes clients, des leads, un marché ou des contacts : utilise ces outils "
            "pour aller chercher des informations réelles (requêtes ciblées, puis lecture de pages utiles), "
            "puis synthétise — ne te contente pas d'inventer des noms ou URLs sans recherche.\n\n"
        ),
    },
    "community_manager": {
        "label": "Community Manager",
        "role": "Instagram & Facebook",
        "tools": ["web", "instagram", "facebook", "drive"],
        "system": (
            "Tu es le Community Manager d'Élude In Art. Tu crées du contenu engageant et authentique "
            "pour Instagram et Facebook autour du Tarot Fleur d'ÅmÔurs. Tu ne survends pas — tu invites.\n\n"
        ),
    },
    "developpeur": {
        "label": "Développeur",
        "role": "Code & architecture",
        "tools": ["web"],
        "system": (
            "Tu es le Développeur d'Élude In Art. Tu développes et maintiens les outils numériques : "
            "Korymb (QG agents), app Fleur d'ÅmÔurs (Next.js), backend FastAPI, questionnaires Ritual. "
            "Stack : React/Vite, Next.js, FastAPI, Docker, Coolify.\n\n"
        ),
    },
    "comptable": {
        "label": "Comptable",
        "role": "Finances & facturation",
        "tools": [],
        "system": (
            "Tu es le Comptable d'Élude In Art (micro-entreprise d'Éric, Tourves, Var). "
            "Tu suis les finances, prépares devis et factures, analyses les revenus.\n\n"
        ),
    },
    "coordinateur": {
        "label": "CIO — Orchestrateur",
        "role": "Stratégie & délégation",
        "tools": ["web", "linkedin", "drive"],
        "is_manager": True,
        "system": (
            "Tu es le CIO (DSI / orchestrateur) d'Élude In Art. Tu as la vision d'ensemble et coordonnes la stratégie globale. "
            "Tu décomposes les objectifs en missions actionnables, assures la cohérence entre toutes les actions "
            "et valides les livrables avant de les soumettre au dirigeant.\n"
            "Tu n'es jamais « seul » : les agents commercial, community_manager, developpeur et comptable sont des "
            "collègues réels que tu actives par planification et délégation. Ne dis jamais que tu ne peux pas faire "
            "intervenir un autre rôle : tu identifies qui est pertinent et tu lui confies une sous-tâche explicite.\n"
            "Pour la prospection, clients, veille marché ou « qui contacter » : délègue au **commercial** des sous-tâches "
            "concrètes du type « rechercher sur le web et LinkedIn public des X dans telle zone / secteur », "
            "car c'est lui qui exécute les recherches Internet (outils web) — pas toi pendant l'étape plan JSON.\n"
            "Tu reçois aussi un bloc « Historique missions Korymb » (missions déjà exécutées, avec livrables). "
            "Exploite-le quand le dirigeant prolonge ou réutilise un travail passé (ex. courriers pour des pistes déjà trouvées) : "
            "ne réponds pas « impossible » sans t'appuyer sur ces sources et citer les #job_id concernés.\n\n"
        ),
    },
}

_agents_merged_cache: dict[str, dict] | None = None


def refresh_agents_definitions_cache() -> None:
    global _agents_merged_cache
    _agents_merged_cache = None


def agents_def() -> dict[str, dict]:
    global _agents_merged_cache
    if _agents_merged_cache is None:
        custom = fetch_custom_agents_definitions_merge_shape()
        merged = dict(BUILTIN_AGENT_DEFINITIONS)
        for k, v in custom.items():
            if k not in BUILTIN_AGENT_DEFINITIONS:
                merged[k] = v
        _agents_merged_cache = merged
    return _agents_merged_cache


def delegatable_subagent_keys_ordered() -> tuple[str, ...]:
    """Sous-agents exécutables (hors CIO), ordre stable : intégrés d'abord, puis customs triés."""
    ad = agents_def()
    prefer = ("commercial", "community_manager", "developpeur", "comptable")
    out: list[str] = []
    for k in prefer:
        if k in ad and k != "coordinateur" and not ad[k].get("is_manager"):
            out.append(k)
    tail = sorted(
        k for k in ad if k not in out and k != "coordinateur" and not ad[k].get("is_manager")
    )
    return tuple(out + tail)


FLEUR_CONTEXT = (
    "Contexte métier Élude In Art :\n"
    "- Créateur : Éric (Tourves, 83170, Var) — eludinart@gmail.com — 0659582428\n"
    "- Site : eludein.art | App : app-fleurdamours.eludein.art\n"
    "- Produit phare : Tarot Fleur d'ÅmÔurs (65 cartes, outil d'analyse systémique des relations)\n"
    "  → 4 familles : 8 formes d'amour (Agapé, Éros, Philia, Storgé, Pragma, Ludus, Mania, Philautia), "
    "cycle végétal (Racines→Nectar), éléments (Feu, Éther, Eau, Air, Terre + cycles), cycle de la vie\n"
    "  → Pas de divination — cartographie systémique des dynamiques relationnelles\n"
    "  → Cible : coachs, thérapeutes, facilitateurs, couples, professionnels de l'accompagnement\n"
    "- Autres services : constellations systémiques, accompagnement relationnel, VIBRÆ (son), "
    "SÏvåñà (écolieu Haut-Var), stages & ateliers\n"
    "- Modules Pro : 7 modules pour former des professionnels à l'usage du tarot\n"
    "- Business model : vente tarot physique, séances individuelles, modules pro, abonnements Stripe\n"
)

MODE_CADRAGE_CIO = (
    "\n\n### Mode cadrage mission (pré-lancement)\n"
    "Tu échanges avec le dirigeant pour CADER la future mission. "
    "Tu NE déclenches PAS le pipeline multi-agents (pas de délégation réelle aux autres rôles, pas de plan JSON d'exécution). "
    "Clarifie l'intention, les critères de succès, les contraintes ; propose un périmètre. "
    "À la fin, rappelle que le dirigeant validera dans l'application pour lancer l'exécution.\n"
)

MODE_CADRAGE_AGENT = (
    "\n\n### Mode cadrage mission (pré-lancement)\n"
    "Tu dialogues avec le dirigeant pour affiner une future mission avant exécution formelle. "
    "Pas encore de livrable d'équipe : questions, hypothèses, proposition de consigne. Reste dans ton rôle. "
    "La validation et le lancement se feront depuis l'application.\n"
)

# Rôles non-CIO (chat direct ou mission « agent seul ») : éviter les refus hors-personnage sur le lien avec le CIO.
SUB_AGENT_COORDINATION_FR = (
    "\n\n### Korymb : lien avec le CIO\n"
    "Dans ce fil tu parles au **dirigeant**. Tu n’as pas une messagerie parallèle type Slack avec le CIO.\n"
    "Si on te demande si tu peux **parler au CIO**, **lui écrire** ou **vérifier avec lui** : réponds **en personnage** "
    "(ton rôle Élude In Art). Explique que le canal d’**équipe avec le CIO**, c’est une **mission pilotée par le CIO** "
    "(Missions / QG) : le CIO confie des sous-tâches, tu livres du texte, le CIO synthétise pour le dirigeant. "
    "Ici tu peux quand même formuler ce que tu aimerais **transmettre au CIO** ; le dirigeant pourra le reporter "
    "lors d’une mission orchestrée.\n"
    "Ne sors **pas** du rôle avec « je suis un modèle de langage », « intelligence artificielle », ou un refus sec du "
    "type « je ne peux pas communiquer avec le CIO » : tu clarifies le **fonctionnement** tout en restant crédible "
    "métier.\n"
)


def _ascii_fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def _tache_to_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        for cand in ("description", "tache", "task", "mission", "detail", "consigne"):
            x = v.get(cand)
            if isinstance(x, str) and x.strip():
                return x.strip()
        try:
            return json.dumps(v, ensure_ascii=False)[:1200]
        except Exception:
            return str(v)[:800]
    return str(v).strip()


# Alias clés plan / champ « agents » → clés d'agents exécutables (hors coordinateur).
_DELEGATION_KEY_ALIASES: dict[str, str] = {
    "commercial": "commercial",
    "commerce": "commercial",
    "vente": "commercial",
    "sales": "commercial",
    "bizdev": "commercial",
    "community_manager": "community_manager",
    "communitymanager": "community_manager",
    "community": "community_manager",
    "cm": "community_manager",
    "social": "community_manager",
    "instagram": "community_manager",
    "developpeur": "developpeur",
    "developer": "developpeur",
    "dev": "developpeur",
    "tech": "developpeur",
    "comptable": "comptable",
    "compta": "comptable",
    "finance": "comptable",
}


def _canon_delegation_agent_key(raw_key: str) -> str | None:
    nk = re.sub(r"\s+", "_", _ascii_fold(raw_key)).replace("-", "_")
    canon = _DELEGATION_KEY_ALIASES.get(nk) or (nk if nk in agents_def() else None)
    if canon is None or canon == "coordinateur":
        return None
    return canon if canon in agents_def() else None


def _plan_token_to_agent_key(token: object) -> str | None:
    """Interprète une entrée du champ JSON « agents » (souvent mal formée)."""
    if not isinstance(token, str):
        return None
    s = token.strip()
    if not s:
        return None
    return _canon_delegation_agent_key(s)


def _filter_plan_agents_to_executable_keys(plan: dict) -> None:
    """Ne garde que les clés commercial / CM / dev / compta (ignore « CIO direct », etc.)."""
    raw = plan.get("agents")
    if not isinstance(raw, list):
        plan["agents"] = []
        return
    out: list[str] = []
    for x in raw:
        k = _plan_token_to_agent_key(x)
        if k and k not in out:
            out.append(k)
    plan["agents"] = out


def _coerce_plan_agents_list(plan: dict) -> None:
    """Le modèle renvoie parfois « agents » comme chaîne ou forme inattendue — normalise en liste de chaînes."""
    raw = plan.get("agents")
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            plan["agents"] = []
            return
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                plan["agents"] = parsed if isinstance(parsed, list) else [str(parsed)]
            except Exception:
                inner = s.strip()
                if inner.startswith("[") and inner.endswith("]"):
                    inner = inner[1:-1].strip()
                plan["agents"] = [p.strip().strip("'\"") for p in inner.split(",") if p.strip()] or [s]
        else:
            plan["agents"] = [s]
        return
    if raw is None:
        plan["agents"] = []
        return
    if not isinstance(raw, list):
        plan["agents"] = []
        return
    plan["agents"] = [str(x).strip() for x in raw if x is not None and str(x).strip()]


def _plan_agents_json_non_executable(raw: object) -> bool:
    """True si « agents » liste des chaînes mais aucune ne correspond à un sous-agent exécutable."""
    if not isinstance(raw, list) or not raw:
        return False
    saw = False
    for item in raw:
        if isinstance(item, str) and item.strip():
            saw = True
            if _plan_token_to_agent_key(item):
                return False
    return saw


def _plan_agents_json_valid_keys(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        k = _plan_token_to_agent_key(item)
        if k and k not in out:
            out.append(k)
    return out


def _repair_plan_delegation_gaps(
    st: dict,
    plan: dict,
    mission_txt: str,
    root_mission_label: str,
    log,
) -> None:
    """
    Corrige les plans où le modèle cite des rôles dans « agents » sans entrée correspondante dans « sous_taches ».
    (Les libellés non reconnus dans « agents » sont traités ensuite par _materialize_subagents_when_plan_empty.)
    """
    raw_agents = plan.get("agents")
    ctx = (root_mission_label or mission_txt or "").strip()
    if len(ctx) > 2400:
        ctx = ctx[:2400] + "…"

    for ag in _plan_agents_json_valid_keys(raw_agents):
        if ag not in agents_def() or ag == "coordinateur":
            continue
        if _tache_to_str(st.get(ag)).strip():
            continue
        st[ag] = (
            f"Le plan JSON cite ce rôle dans « agents » mais sans consigne exploitable dans « sous_taches ». "
            f"Exécute pour le dirigeant (français, réponse réelle, pas de simulation « en attente ») :\n\n{ctx}"
        )
        log(
            f"[korymb] Correctif plan : sous-tâche générée pour {agents_def()[ag]['label']} "
            f"(présent dans « agents », absent ou vide dans « sous_taches »).",
        )


def _infer_agents_from_mission_keywords(t: str) -> list[str]:
    """Quand le plan JSON est vide ou inutile : sous-agents plausiblement pertinents d'après le vocabulaire."""
    found: list[str] = []
    # « Quelle heure » / « demande l'heure au commercial » : déclencher un tour commercial même sans mot « commercial ».
    if re.search(
        r"\b(quelle\s+heure|quel\s+heure|lheure\b|heure\s+actuelle|heure\s+il\s+est|fuseau|horloge|utc)\b"
        r"|demande.{0,60}heure|heure.{0,60}commercial|parl\w*.{0,50}commercial",
        t,
    ):
        found.append("commercial")
    if re.search(
        r"\b(commercial|commerciale|prospect|prospection|client|clients|lead|leads|linkedin|vente|vendre|"
        r"marche|marches|piste|pistes|cible|cibles|coach|therapeute|accompagnement|qui\s+contacter)\b",
        t,
    ):
        found.append("commercial")
    if re.search(
        r"\b(developpeur|developper|programmeur|programme|code|api|apis|bug|bugs|deploy|docker|fastapi|"
        r"react|vite|git|stack|backend|front|frontend|typescript|javascript|endpoint|sql|route|middleware|"
        r"korymb|coolify|next\.js|nextjs)\b",
        t,
    ):
        found.append("developpeur")
    if re.search(
        r"\b(community|instagram|facebook|communaute|communaut|publication|publications|audience|"
        r"reseau\s+social|reseaux\s+sociaux|story|reel|cm\b)\b",
        t,
    ):
        found.append("community_manager")
    if re.search(
        r"\b(compta|comptable|factur|facture|factures|tva|urssaf|devis|bilan|tresorerie|treso|impot|impots)\b",
        t,
    ):
        found.append("comptable")
    out: list[str] = []
    seen: set[str] = set()
    for k in delegatable_subagent_keys_ordered():
        if k in found and k not in seen:
            out.append(k)
            seen.add(k)
    return out


def _has_executable_subagent_tasks(st: dict) -> bool:
    return any(
        _tache_to_str(st.get(k)).strip()
        for k in delegatable_subagent_keys_ordered()
        if k in agents_def() and k != "coordinateur"
    )


def _recovery_task_for_sub_agent(agent_key: str, ctx: str) -> str:
    lab = agents_def()[agent_key]["label"]
    return (
        f"Le CIO t'a confié cette demande du dirigeant (le plan automatique était incomplet ou invalide). "
        f"Tu es le **{lab}** : exécute pour de vrai en français — réponse utile, faits ou limites honnêtes, "
        f"sans jouer la comédie « j'attends un autre collègue ».\n\n{ctx}"
    )


def _materialize_subagents_when_plan_empty(
    st: dict,
    plan: dict,
    mission_txt: str,
    root_mission_label: str,
    log,
) -> None:
    """
    Dernière ligne : si aucune sous-tâche exécutable n'a été produite, on déduit les rôles depuis le texte
    (mentions explicites, puis mots-clés), ou on déploie toute l'équipe si le dirigeant demande un test multi-agents.
    """
    if _has_executable_subagent_tasks(st):
        return
    blob = _ascii_fold(f"{mission_txt}\n{root_mission_label}")
    if len(blob.strip()) < 12:
        return
    ctx = (root_mission_label or mission_txt or "").strip()
    if len(ctx) > 2400:
        ctx = ctx[:2400] + "…"

    keys: list[str] = list(_mentioned_sub_agents(blob))
    if not keys:
        keys = _infer_agents_from_mission_keywords(blob)
    if not keys and _signals_explicit_multi_agent_communication(blob):
        keys = list(delegatable_subagent_keys_ordered())
    raw_agents = plan.get("agents")
    if not keys:
        if (
            _plan_agents_json_non_executable(raw_agents)
            or raw_agents is None
            or (isinstance(raw_agents, list) and len(raw_agents) == 0)
            or len(blob) > 40
        ):
            keys = ["commercial"]

    added: list[str] = []
    for ag in keys:
        if ag not in agents_def() or ag == "coordinateur":
            continue
        if _tache_to_str(st.get(ag)).strip():
            continue
        st[ag] = _recovery_task_for_sub_agent(ag, ctx)
        added.append(ag)
    if added:
        log(
            "[korymb] Délégation matérialisée (aucune tâche exécutable dans le plan) : "
            + ", ".join(agents_def()[x]["label"] for x in added),
        )
    elif not _has_executable_subagent_tasks(st) and len(blob.strip()) >= 8:
        st["commercial"] = _recovery_task_for_sub_agent("commercial", ctx)
        log("[korymb] Délégation matérialisée (filet absolu — tour Commercial, plan stérile).")


def _log_plan_agents_field_for_ops(raw: object, log) -> None:
    """Ne propage pas de libellés bidons du modèle comme s'ils étaient des rôles réels."""
    if raw is None:
        return
    valid = _plan_agents_json_valid_keys(raw)
    noise: list[str] = []
    if isinstance(raw, list):
        for x in raw:
            if isinstance(x, str) and x.strip() and not _plan_token_to_agent_key(x):
                noise.append(x.strip()[:72])
    if noise:
        log(f"[korymb] Plan JSON : entrées « agents » ignorées (non reconnues) : {noise[:10]}")
    if valid:
        log(f"[korymb] Plan JSON : agents reconnus dans « agents » : {valid}")


def _normalize_sous_taches(raw: dict) -> tuple[dict, list[str]]:
    """
    Ramène les clés du plan (souvent mal typées par le LLM) vers les clés agents_def().
    Retourne (sous_taches_canoniques, clés_sources_ignorées).
    """
    out: dict[str, str] = {}
    skipped: list[str] = []
    for k, v in (raw or {}).items():
        if not isinstance(k, str):
            continue
        nk = re.sub(r"\s+", "_", _ascii_fold(k)).replace("-", "_")
        canon = _DELEGATION_KEY_ALIASES.get(nk) or (nk if nk in agents_def() else None)
        if canon is None or canon == "coordinateur":
            skipped.append(str(k))
            continue
        ts = _tache_to_str(v)
        if not ts:
            skipped.append(str(k))
            continue
        if canon in out:
            out[canon] = f"{out[canon]}\n\n{ts}"
        else:
            out[canon] = ts
    return out, skipped


# Clés fréquentes quand le LLM ne respecte pas exactement « sous_taches » (underscore sans accent).
_SOUS_TACHES_PLAN_KEYS: tuple[str, ...] = (
    "sous_taches",
    "sous_tâches",
    "sous-taches",
    "soustaches",
    "subtasks",
    "tasks",
    "delegations",
    "assignments",
    "agent_tasks",
)


def _extract_sous_taches_from_plan(plan: dict) -> dict:
    """
    Fusionne les dictionnaires de sous-tâches depuis toutes les variantes de clés connues.
    Sans cela, un JSON valide avec « sous_tâches » ou « subtasks » produit zéro délégation réelle.
    """
    merged: dict[str, object] = {}
    for pk in _SOUS_TACHES_PLAN_KEYS:
        cand = plan.get(pk)
        if not isinstance(cand, dict):
            continue
        for k, v in cand.items():
            prev = merged.get(k)
            if prev is None:
                merged[k] = v
                continue
            ps = _tache_to_str(prev).strip()
            vs = _tache_to_str(v).strip()
            if not ps and vs:
                merged[k] = v
            elif vs and len(vs) > len(ps):
                merged[k] = v
    return merged


def _extract_json_object(s: str) -> str | None:
    i = s.find("{")
    if i < 0:
        return None
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return s[i : j + 1]
    return None


def _mission_suggests_commercial(text: str) -> bool:
    """Heuristique : le commercial a les outils web / prospection — élargie pour éviter un CIO seul sur du transverse."""
    t = _ascii_fold(text or "")
    if re.search(r"\bcommercial\b", t):
        return True
    hints = (
        "prospect", "client", "vendre", "vente", "lead", "contact", "coach", "therapeute",
        "linkedin", "var", "recherche", "trouver", "liste", "email", "cible", "marche",
        "piste", "accompagnement", "qui contacter", "personnes",
        "elude", "tarot", "fleur", "korymb", "entreprise", "activite", "offre", "strategie",
        "organisation", "communication", "marketing", "partenaire", "reseau", "promotion",
        "developper", "outil", "site", "app", "atelier", "stage", "module",
    )
    return any(h in t for h in hints)


# Outils dont la trace suffit à prouver une recherche Internet / surface publique.
_WEB_RESEARCH_TOOL_NAMES = frozenset({"web_search", "read_webpage", "search_linkedin"})
_DEV_WEB_RESEARCH_TOOL_NAMES = frozenset({"web_search", "read_webpage"})

_COMMERCIAL_WEB_MANDATE_SUFFIX = (
    "\n\n---\n**Obligation outils (système)** : cette consigne implique des faits ou des pistes sur le terrain / le web. "
    "Tu DOIS invoquer au minimum une fois **`web_search`** avec une requête en français ciblée (métier, zone, thème), "
    "puis si utile **`search_linkedin`** ou **`read_webpage`** sur une URL pertinente des résultats. "
    "Ensuite seulement, livre ta synthèse avec des exemples identifiables (pas de liste inventée sans recherche)."
)

_DEVELOPER_WEB_MANDATE_SUFFIX = (
    "\n\n---\n**Obligation outils (système)** : cette consigne implique une vérification documentaire ou technique en ligne. "
    "Tu DOIS appeler au minimum une fois **`web_search`** (ou **`read_webpage`** sur une URL fournie), puis synthétiser."
)

_REPAIR_WEB_TOOLS_SUFFIX = (
    "\n\n---\n**Relance obligatoire (système)** : aucun appel `web_search`, `read_webpage` ou `search_linkedin` "
    "n’a été enregistré pour ton tour. Recommence : exécute d’abord **`web_search`** avec une requête précise, "
    "puis au besoin `read_webpage` ou `search_linkedin`, puis termine par une réponse sourcée."
)

_REPAIR_DEV_WEB_TOOLS_SUFFIX = (
    "\n\n---\n**Relance obligatoire (système)** : aucun appel `web_search` ou `read_webpage` n’a été enregistré. "
    "Utilise **`web_search`** (ou `read_webpage` sur une doc officielle), puis conclus."
)


def _blob_needs_commercial_web_evidence(per: str) -> bool:
    """True si la consigne ressemble à de la prospection / veille nécessitant le web (hors simple mail)."""
    t = _ascii_fold(per or "")
    if re.search(r"\b(prospect|prospects|prospection|lead|leads)\b", t):
        return True
    if re.search(r"\bpistes?\b", t):
        return True
    if "linkedin" in t and re.search(r"\b(recherche|trouv|cibl|liste|profil|contact)\b", t):
        return True
    if re.search(r"\bqui contacter\b|\bou contacter\b", t):
        return True
    if re.search(r"\bliste\b", t) and re.search(
        r"\b(contact|contacts|prospect|prospects|structure|structures|nom|noms|client|clients|entreprise|entreprises|public)\b",
        t,
    ):
        return True
    if re.search(r"\b(recherche|recherches)\b", t) and ("web" in t or "internet" in t or "en ligne" in t):
        return True
    if re.search(r"\btrouver\b", t) and re.search(
        r"\b(contact|structure|client|coach|therapeute|professionnel|accompagnant|cible)\b",
        t,
    ):
        return True
    if re.search(r"\bveille\b", t) and re.search(r"\b(marche|concurrent|concurrence|secteur)\b", t):
        return True
    return False


def _blob_needs_developer_web_evidence(per: str) -> bool:
    t = _ascii_fold(per or "")
    return bool(
        re.search(
            r"\b(stack overflow|stackoverflow|github|documentation|docs?\s+api|npm|pypi|issue\s*#|pull request)\b",
            t,
        )
    )


def _agent_tool_tags_include_webish(agent_key: str) -> bool:
    tags = agents_def().get(agent_key, {}).get("tools") or []
    return any(x in ("web", "linkedin") for x in tags)


def _count_agent_tool_calls(events: list | None, agent_key: str, tool_names: frozenset[str]) -> int:
    n = 0
    if not isinstance(events, list):
        return 0
    for e in events:
        if not isinstance(e, dict):
            continue
        if e.get("type") != "tool_call":
            continue
        if (e.get("agent") or "") != agent_key:
            continue
        t = (e.get("payload") or {}).get("tool") or ""
        if t in tool_names:
            n += 1
    return n


def _agent_had_technical_failure(txt: str) -> bool:
    return "Erreur technique" in (txt or "")


def _compute_delivery_warnings(
    *,
    resultats: dict[str, str],
    sous_taches: dict,
    events: list,
    root_mission_label: str,
    mission_txt: str,
) -> list[str]:
    """Alertes dirigeant : mission web attendue mais aucune trace d'outil correspondant."""
    warnings: list[str] = []
    for ag in resultats:
        if ag not in agents_def() or ag == "coordinateur":
            continue
        if not _agent_tool_tags_include_webish(ag) and ag != "developpeur":
            continue
        out_txt = resultats.get(ag) or ""
        if _agent_had_technical_failure(out_txt):
            continue
        tache = _tache_to_str(sous_taches.get(ag))
        per = f"{tache}\n{root_mission_label}\n{mission_txt}"
        label = agents_def()[ag]["label"]
        if ag == "commercial" and _blob_needs_commercial_web_evidence(per):
            if _count_agent_tool_calls(events, ag, _WEB_RESEARCH_TOOL_NAMES) == 0:
                warnings.append(
                    f"{label} : la mission demandait des pistes / recherche web ou LinkedIn public, "
                    f"mais aucun appel enregistré à web_search, read_webpage ou search_linkedin — "
                    f"le livrable peut être non sourcé."
                )
        elif ag == "developpeur" and _agent_tool_tags_include_webish(ag) and _blob_needs_developer_web_evidence(per):
            if _count_agent_tool_calls(events, ag, _DEV_WEB_RESEARCH_TOOL_NAMES) == 0:
                warnings.append(
                    f"{label} : la consigne suggérait une vérification documentaire en ligne, "
                    f"sans trace d'appel web_search ou read_webpage."
                )
    return warnings


def _extract_delivery_warnings_from_events(events: list | None) -> list[str]:
    if not isinstance(events, list):
        return []
    for i in range(len(events) - 1, -1, -1):
        e = events[i]
        if not isinstance(e, dict):
            continue
        if e.get("type") != "delivery_review":
            continue
        pl = e.get("payload") or {}
        w = pl.get("warnings")
        if isinstance(w, list):
            return [str(x).strip() for x in w if str(x).strip()]
    return []


def _signals_explicit_multi_agent_communication(t: str) -> bool:
    """Le dirigeant veut que des rôles réels passent (pas seulement une synthèse CIO « sur papier »)."""
    tn = t.replace("'", "").replace("\u2019", "")
    return any(
        p in tn
        for p in (
            "rentrer en communication",
            "rentre en communication",
            "rentres en communication",
            "communication avec",
            "test de communication",
            "centraliser les retours",
            "confirmer que tu as bien recu",
            "quil te reponde",
            "quils te repond",
            "quils te repondent",
            "avec les differents agents",
            "les differents agents",
            "plusieurs agents",
            "tous les agents",
            "chaque agent",
        )
    ) or ("test" in tn and "communication" in tn and "agent" in tn)


def _mentioned_sub_agents(t: str) -> list[str]:
    """Détecte quels sous-agents sont nommés dans le texte (déjà ASCII-fold, minuscules)."""
    found: list[str] = []
    if (
        re.search(r"\bcommercial\b", t)
        or re.search(r"\bcommerciale\b", t)
        or re.search(r"\bcommerciaux\b", t)
        or re.search(r"\b(the\s+)?commercial(\s+agent)?\b", t)
        or re.search(r"\bask\s+.{0,56}\bcommercial\b", t)
        or re.search(r"\btell\s+.{0,56}\bcommercial\b", t)
    ):
        found.append("commercial")
    if re.search(r"\b(salesperson|sales\s+rep|sales\s+team|account\s+executive)\b", t):
        found.append("commercial")
    if re.search(
        r"community_manager|gestionnaire.{0,32}communaut|gestionnaire.{0,32}communaute|"
        r"\bcm\b|community manager|reseaux?.{0,10}sociaux",
        t,
    ):
        found.append("community_manager")
    if re.search(r"developpeur|developper|programmeur|\bdev\b", t):
        found.append("developpeur")
    if re.search(r"\bcomptable\b|\bcompta\b", t):
        found.append("comptable")
    out: list[str] = []
    seen: set[str] = set()
    for k in delegatable_subagent_keys_ordered():
        if k in found and k not in seen:
            out.append(k)
            seen.add(k)
    return out


def _inject_sous_taches_for_mentioned_agents(
    st: dict,
    mission_txt: str,
    root_mission_label: str,
    log,
) -> None:
    """
    Si la consigne nomme explicitement un rôle (ex. « le commercial ») mais le plan JSON n’a aucune
    sous-tâche valide pour lui (clés hors les quatre rôles exécutables), on ajoute une sous-tâche réelle.
    """
    blob = _ascii_fold(f"{mission_txt}\n{root_mission_label}")
    for key in _mentioned_sub_agents(blob):
        if key not in agents_def() or key == "coordinateur":
            continue
        if _tache_to_str(st.get(key)).strip():
            continue
        ctx = (root_mission_label or mission_txt or "").strip()
        if len(ctx) > 1400:
            ctx = ctx[:1400] + "…"
        st[key] = (
            "Le CIO te confie une demande du dirigeant (texte ci-dessous). Réponds de façon directe et utile, en français ; "
            "si on te demande une information factuelle, réponds factuellement ou dis ce que tu ne peux pas savoir.\n\n"
            + ctx
        )
        log(
            f"[korymb] Filet délégation : sous-tâche ajoutée pour {agents_def()[key]['label']} "
            "(rôle nommé dans la mission, absent ou invalide dans le plan JSON du modèle).",
        )


def _forced_multi_agent_sous_taches(mission_txt: str, root_mission_label: str) -> dict[str, str] | None:
    """
    Quand le dirigeant demande un test de communication ou des réponses de plusieurs rôles,
    on force des sous_tâches réelles (le modèle plan JSON a souvent tendance à répondre « CIO seul »).
    """
    blob = _ascii_fold(f"{mission_txt}\n{root_mission_label}")
    if not _signals_explicit_multi_agent_communication(blob):
        return None
    mentioned = _mentioned_sub_agents(blob)
    if len(mentioned) >= 2:
        targets = mentioned
    elif len(mentioned) == 1:
        targets = mentioned
    elif re.search(r"differents.{0,14}agents|plusieurs agents|tous les agents|chaque agent", blob):
        targets = list(delegatable_subagent_keys_ordered())
    else:
        # « Test de communication », etc. : le signal est levé mais aucun rôle n’est nommé dans le texte —
        # sans cette branche on retombait en CIO seul alors que le dirigeant attend des tours réels.
        targets = list(delegatable_subagent_keys_ordered())
    ctx = (root_mission_label or mission_txt or "").strip()
    if len(ctx) > 720:
        ctx = ctx[:720] + "…"
    out: dict[str, str] = {}
    for k in targets:
        label = agents_def()[k]["label"]
        out[k] = (
            f"Le dirigeant demande un test de coordination via le CIO. "
            f"Réponds en français, 2 à 5 phrases : confirme que tu as bien reçu cette sollicitation ; "
            f"résume en une phrase ton périmètre ({label}) ; dis si le canal te semble opérationnel. "
            f"Ne simule pas d'autres collègues. Contexte : {ctx}"
        )
    return out or None


def _clip_mem_text(s: str, max_len: int) -> str:
    t = (s or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _past_missions_context_block(
    *,
    exclude_job_id: str | None,
    max_total: int = 22_000,
    digest_limit: int = 10,
    compact: bool = False,
) -> str:
    """Synthèses des missions passées (SQLite) — continuité / science d'entreprise."""
    try:
        digest = list_jobs_prompt_digest(limit=digest_limit, exclude_job_id=exclude_job_id)
    except Exception:
        logger.exception("list_jobs_prompt_digest")
        return ""
    if not digest:
        return ""
    if compact:
        header = "\n".join(
            [
                "--- Extraits missions passées (référence interne) ---",
                "Tu peux t'appuyer sur ces livrables déjà produits ; cite #job_id si tu réutilises une source.",
                "",
            ]
        )
    else:
        header = "\n".join(
            [
                "--- Historique missions Korymb (base locale) ---",
                "Missions déjà exécutées. Réutilise ces livrables quand le dirigeant fait référence au travail passé, "
                "à une mission précédente, ou à des éléments « déjà trouvés ». Cite le #job_id lorsque tu t'appuies sur une source.",
                "",
            ]
        )
    footer = "\n--- Fin historique missions ---\n"
    budget = max(4000, max_total - len(header) - len(footer) - 80)
    n = len(digest)
    per0 = budget // max(1, n)
    per = max(900, min(5200, per0))
    parts: list[str] = [header]
    used = 0
    for d in digest:
        jid = str(d.get("id") or "")
        agent = str(d.get("agent") or "")
        st = str(d.get("status") or "")
        created = str(d.get("created_at") or "")[:22]
        src = str(d.get("source") or "")
        mis = _clip_mem_text(str(d.get("mission") or ""), 1400)
        res_raw = str(d.get("result") or "").strip()
        remain = budget - used
        if remain < 400:
            break
        cap = min(per, remain - 120)
        body = _clip_mem_text(res_raw, cap) if res_raw else "(aucun livrable textuel enregistré)"
        block = (
            f"### Mission #{jid} · agent pilote: {agent} · {st} · {created} · source {src}\n"
            f"Consigne :\n{mis}\n\nSynthèse / livrable :\n{body}\n"
        )
        parts.append(block)
        used += len(block)
    parts.append(footer)
    return "\n".join(parts)


def _korymb_memory_prompt_for(agent_key: str, *, exclude_job_id: str | None = None) -> str:
    """Bloc texte injecté dans le system prompt : mémoire entreprise + missions récentes (+ historique DB pour le CIO)."""
    try:
        mem = get_enterprise_memory()
    except Exception:
        return ""
    contexts = mem.get("contexts") or {}
    recent = mem.get("recent_missions") or []
    if not isinstance(recent, list):
        recent = []

    def ctx(k: str) -> str:
        v = contexts.get(k)
        return v.strip() if isinstance(v, str) else ""

    sub_keys = delegatable_subagent_keys_ordered()
    has_roles = any(ctx(k) for k in sub_keys)

    db_block = ""
    if agent_key == "coordinateur":
        try:
            db_block = _past_missions_context_block(exclude_job_id=exclude_job_id)
        except Exception:
            logger.exception("_past_missions_context_block")

    if not ctx("global") and not has_roles and not recent and not db_block:
        return ""

    lines: list[str] = ["", "--- Mémoire entreprise (persistante) ---"]

    if agent_key == "coordinateur":
        if ctx("global"):
            lines.append("Contexte global :\n" + _clip_mem_text(ctx("global"), 4000))
        for rk in sub_keys:
            block = ctx(rk)
            if not block:
                continue
            label = agents_def().get(rk, {}).get("label", rk)
            lines.append(f"Périmètre {label} :\n" + _clip_mem_text(block, 1600))
        if db_block.strip():
            lines.append(db_block.rstrip())
    else:
        if ctx("global"):
            lines.append("Contexte global (extrait) :\n" + _clip_mem_text(ctx("global"), 1400))
        rk = agent_key
        if rk in agents_def() and rk != "coordinateur":
            block = ctx(rk)
            if block:
                label = agents_def()[rk]["label"]
                lines.append(f"Ton périmètre ({label}) :\n" + _clip_mem_text(block, 2400))
        if sub_digest.strip():
            lines.append(sub_digest.rstrip())

    if recent:
        if agent_key == "coordinateur":
            shown_db = set()
            if db_block:
                for m in re.finditer(r"### Mission #([0-9a-fA-F-]{4,20})", db_block):
                    shown_db.add(m.group(1))
            lines.append("Missions récentes (mémoire de clôture — complément si une mission n'apparaît pas ci-dessus) :")
            tail = recent[-8:]
            for item in tail:
                if not isinstance(item, dict):
                    continue
                jid = str(item.get("job_id") or "")
                if jid and jid in shown_db:
                    continue
                m = _clip_mem_text(str(item.get("mission") or ""), 360)
                pv = _clip_mem_text(str(item.get("preview") or ""), 2800)
                lines.append(f"  · #{jid}\n    Consigne : {m}\n    Extrait livrable : {pv}")
        else:
            lines.append("Missions récentes (résumé — le CIO porte l'historique détaillé) :")
            tail = recent[-6:]
            for item in tail:
                if not isinstance(item, dict):
                    continue
                jid = str(item.get("job_id") or "")
                m = _clip_mem_text(str(item.get("mission") or ""), 160)
                pv = _clip_mem_text(str(item.get("preview") or ""), 320)
                lines.append(f"  · #{jid} {m} → {pv}")

    lines.append("--- Fin mémoire entreprise ---")
    return "\n".join(lines)


def _clip_dialogue_public(s: str, max_len: int = 10_000) -> str:
    t = (s or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _clip_one_line(s: str | None, max_len: int = 1200) -> str:
    """Réduit à une ligne lisible pour les logs mission (terminal / UI)."""
    t = " ".join((s or "").strip().split())
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _persist_running_job_snapshot(job_id: str | None) -> None:
    """Écrit l’état courant du job en base pendant l’exécution (logs, équipe, plan, événements)."""
    if not job_id or job_id not in active_jobs:
        return
    j = active_jobs[job_id]
    if j.get("status") != "running":
        return
    try:
        update_job(
            job_id,
            "running",
            j.get("result"),
            j.get("logs") or [],
            int(j.get("tokens_in", 0)),
            int(j.get("tokens_out", 0)),
            j.get("team") or [],
            j.get("plan") or {},
            j.get("events") or [],
            source=j.get("source"),
            mission_config=j.get("mission_config") if isinstance(j.get("mission_config"), dict) else None,
        )
    except Exception:
        logger.exception("persist running job snapshot")


def _human_dialogue_cio_assign(agent_key: str, tache: str, chain_prev: str) -> str:
    """Réplique orale courte du CIO vers un rôle (affichage « conversation humaine »)."""
    lab = agents_def()[agent_key]["label"]
    me = agents_def()["coordinateur"]["label"]
    t = str(tache).strip().replace("\n", " ")
    if len(t) > 1400:
        t = t[:1400] + "…"
    if chain_prev == "coordinateur":
        return (
            f"Bonjour {lab}, c’est {me}. Pour ce que demande le dirigeant, j’ai besoin de ton regard. "
            f"Voilà ce que je te propose de traiter : {t}"
        )
    prev = agents_def()[chain_prev]["label"]
    return (
        f"{lab}, toujours {me} — merci à {prev} pour sa partie ; j’enchaîne avec toi. "
        f"Peux-tu t’occuper de ceci : {t}"
    )


def _human_dialogue_cio_wrapup(agent_keys: list[str]) -> str:
    me = agents_def()["coordinateur"]["label"]
    if not agent_keys:
        return f"{me} — Je synthétise tout ça pour le dirigeant."
    labs = [agents_def()[k]["label"] for k in agent_keys if k in agents_def()]
    s = ", ".join(labs) if labs else "l’équipe"
    return (
        f"Parfait, merci {s}. Je recoupe vos retours et je rédige la synthèse pour le dirigeant — "
        "vous retrouverez l’ensemble structuré dans ma réponse finale."
    )


def _team_livrables_markdown_annex(resultats: dict[str, str]) -> str:
    """Annexe lisible dans le corps du résultat mission : textes intégraux des rôles."""
    if not resultats:
        return ""
    parts: list[str] = []
    for k, txt in resultats.items():
        if k not in agents_def() or k == "coordinateur":
            continue
        body = (txt or "").strip()
        if len(body) > 14_000:
            body = body[:14_000] + "\n\n*(suite tronquée pour affichage)*"
        parts.append(f"### {agents_def()[k]['label']}\n\n{body}")
    if not parts:
        return ""
    return (
        "\n\n---\n\n## Livrables bruts de l’équipe\n\n"
        "*Textes intégraux produits par chaque rôle pendant cette mission (hors reformatage du CIO).*\n\n"
        + "\n\n".join(parts)
    )


def orchestrate_coordinateur_mission(
    mission_txt: str,
    root_mission_label: str,
    job_logs: list | None,
    chat_mode: bool = False,
    job_id: str | None = None,
) -> tuple[str, int, int]:
    """
    Plan JSON → exécution par sous-agents → synthèse CIO.
    mission_txt : texte analysé par le CIO (peut inclure historique de chat).
    root_mission_label : rappel court pour les sous-agents (souvent la demande brute utilisateur).
    job_id : si fourni (mission /run), met à jour active_jobs[job_id]["team"] pour l'interface.
    """
    agent_cfg = agents_def()["coordinateur"]
    memory_brain = _korymb_memory_prompt_for("coordinateur", exclude_job_id=job_id)
    system_prompt = agent_cfg["system"] + FLEUR_CONTEXT + memory_brain
    deleg = delegatable_subagent_keys_ordered()
    keys_csv = ", ".join(deleg) if deleg else "commercial, community_manager, developpeur, comptable"
    if len(deleg) >= 2:
        ex_a, ex_b = deleg[0], deleg[1]
    elif len(deleg) == 1:
        ex_a, ex_b = deleg[0], deleg[0]
    else:
        ex_a, ex_b = "commercial", "community_manager"
    agents_example_json = json.dumps([ex_a, ex_b], ensure_ascii=False)
    sous_example_json = json.dumps({ex_a: "...", ex_b: "..."}, ensure_ascii=False)
    max_sub = min(4, len(deleg)) if deleg else 4
    t_in = t_out = 0
    team_rows: list[dict] = []
    cio_trace_run = f"orch_{uuid.uuid4().hex[:12]}"
    # region agent log
    _cio_ndjson_trace(
        cio_trace_run,
        "H4",
        "main.py:orchestrate_coordinateur_mission",
        "orchestration_enter",
        {
            "job_id_set": bool(job_id),
            "job_in_active_jobs": job_id in active_jobs if job_id else False,
            "chat_mode": chat_mode,
            "mission_preview": (root_mission_label or "")[:160],
        },
    )
    # endregion

    def log(msg: str):
        if job_logs is not None:
            job_logs.append(msg)

    def pub_team():
        _publish_team(job_id, team_rows)

    if job_id:
        team_rows.append({
            "key": "coordinateur",
            "label": agent_cfg["label"],
            "status": "running",
            "phase": "plan",
            "detail": "Élaboration du plan de délégation",
        })
        pub_team()
        _emit_job_event(
            job_id,
            "orchestration_start",
            "coordinateur",
            {"chat_mode": chat_mode, "mission_preview": (root_mission_label or "")[:400]},
        )

    log("[korymb] CIO — analyse de la mission...")
    _raise_if_job_cancelled(job_id)
    plan_txt, ti, to = llm_turn(
        system_prompt + "\n\nTu dois répondre UNIQUEMENT avec un JSON structuré.",
        f"""Mission : {mission_txt}

Analyse cette mission et réponds avec ce JSON exact (sans markdown) :
{{
  "agents": {agents_example_json},
  "sous_taches": {sous_example_json},
  "synthese_attendue": "ce que le CIO doit produire en synthèse finale"
}}

Règles :
- La clé du dictionnaire de délégation DOIT s'appeler exactement **sous_taches** (sans accent sur le « e »).
  Ne renomme pas ce champ en « sous_tâches », « subtasks » ou « tasks » : le parseur ne les lit qu'en secours.
- Les clés dans "sous_taches" DOIVENT être EXACTEMENT l'une des clés techniques suivantes (minuscules, underscores) : {keys_csv}.
  Pas de majuscules (pas "Commercial"), pas de libellés français à la place de la clé.
- Choisis 1 à {max_sub} agents VRAIMENT nécessaires (jusqu'à {max_sub} si le dirigeant demande un test impliquant chaque rôle).
- Test de communication, « chaque agent », « les différents agents » : une entrée dans "sous_taches" par rôle concerné,
  avec une consigne qui leur demande une courte réponse de confirmation — ne simule pas leurs réponses, fais-les passer.
- Si l'utilisateur demande qu'un rôle précis agisse (ex. « le développeur », « la compta », ou un rôle personnalisé par sa clé),
  tu DOIS inclure la clé correspondante dans sous_taches avec une sous-tâche actionnable.
- Le champ "agents" est optionnel ; s'il est présent, ce doit être **uniquement** le tableau JSON des clés exactes parmi : {keys_csv}
  (zéro ou plusieurs entrées). N'invente **aucun** autre identifiant :
  tout texte qui n'est pas une de ces clés est ignoré par le moteur et **aucun** sous-agent ne part.
  **Interdit** dans "agents" : « CIO », « CIO direct », « coordinateur », « solo », « seul », toute variante qui n'est pas une clé de la liste — sinon la délégation réelle échoue.
- Pour une mission sans délégation : "agents": [] **et** "sous_taches": {{}} — le CIO répondra seul après coup.
- Chaque clé listée dans "agents" DOIT avoir une entrée non vide correspondante dans "sous_taches" (même clé),
  sinon ce rôle ne partira pas.
- Si le dirigeant demande explicitement de solliciter un rôle (ex. « au commercial », « que le dev vérifie »), mets OBLIGATOIREMENT
  la clé correspondante dans "sous_taches" avec la consigne réelle ; ne remplace pas cela par une entrée « CIO seul ».
- Prospection, clients, leads, « trouver qui contacter », veille concurrentielle : si la clé **commercial** existe dans l'équipe,
  inclus **commercial** dans sous_taches avec une consigne explicite de recherche (web + LinkedIn public + synthèse de pistes), car le commercial a les outils Internet.
- Demande transverse sur l'activité Élude In Art (produit, offre, visibilité, partenariats, contenu, terrain) sans être
  uniquement du code ou de la compta : si la clé **commercial** existe, inclus **commercial** avec une sous-tâche de veille / pistes / angle d'approche,
  sauf si l'utilisateur exige explicitement un autre seul rôle.
- Ne renvoie pas un JSON vide si une délégation est demandée ou pertinente.""",
        max_tokens=4096,
        or_profile="standard",
        usage_job_id=job_id,
        usage_context="cio_plan_json",
    )
    t_in += ti
    t_out += to
    _sync_active_job_tokens(job_id, t_in, t_out)
    _raise_if_job_cancelled(job_id)

    raw_plan = plan_txt.strip()
    if raw_plan.startswith("```"):
        raw_plan = re.sub(r"^```(?:json)?\s*", "", raw_plan, flags=re.IGNORECASE)
        raw_plan = re.sub(r"\s*```\s*$", "", raw_plan)
    try:
        plan = json.loads(raw_plan)
    except Exception:
        blob = _extract_json_object(raw_plan)
        try:
            plan = json.loads(blob) if blob else {}
        except Exception:
            plan = {}
    if not isinstance(plan, dict) or not plan:
        plan = {"agents": [], "sous_taches": {}, "synthese_attendue": ""}
    _coerce_plan_agents_list(plan)
    ag_pre_filter = list(plan["agents"]) if isinstance(plan.get("agents"), list) else []
    _filter_plan_agents_to_executable_keys(plan)
    if ag_pre_filter != (plan.get("agents") or []):
        log(
            f"[korymb] Plan JSON agents : entrées modèle {ag_pre_filter!r} "
            f"→ rôles exécutables {plan.get('agents')!r}",
        )

    raw_mono = plan.get("sous_taches")
    st = _extract_sous_taches_from_plan(plan)
    plan["sous_taches"] = st
    if st and (not isinstance(raw_mono, dict) or not raw_mono):
        log(
            "[korymb] Plan : sous-tâches lues depuis une clé alternative "
            "(ex. « sous_tâches », « subtasks ») — délégation corrigée.",
        )
    if not isinstance(st, dict):
        st = {}
    st, skipped_st = _normalize_sous_taches(st)
    if skipped_st:
        log(f"[korymb] Clés sous_tâches ignorées ou vides : {', '.join(skipped_st[:15])}{'…' if len(skipped_st) > 15 else ''}")
        blob_sk = _ascii_fold(" ".join(skipped_st)).lower()
        if re.search(r"cio|coordinateur|direct", blob_sk):
            log(
                "[korymb] Note : certaines clés du plan (coordinateur, intitulés hors rôles exécutables) ne lancent aucun "
                f"sous-agent — seules les clés suivantes exécutent un tour : {keys_csv}."
            )
    _log_plan_agents_field_for_ops(plan.get("agents"), log)
    st.pop("coordinateur", None)
    plan["sous_taches"] = st

    forced_st = _forced_multi_agent_sous_taches(mission_txt, root_mission_label)
    if forced_st:
        for fk, fv in forced_st.items():
            st[fk] = fv
        plan["sous_taches"] = st
        log(
            "[korymb] Délégation forcée (communication / test multi-rôles) : "
            + ", ".join(agents_def()[k]["label"] for k in forced_st)
        )

    _inject_sous_taches_for_mentioned_agents(st, mission_txt, root_mission_label, log)
    plan["sous_taches"] = st

    if (
        "commercial" in agents_def()
        and not any(
            _tache_to_str(st.get(k)).strip()
            for k in st
            if k in agents_def() and k != "coordinateur"
        )
        and _mission_suggests_commercial(f"{mission_txt}\n{root_mission_label}")
    ):
        st["commercial"] = (
            "Recherche web + LinkedIn public pour la demande du dirigeant ; "
            "liste courte de pistes (structures / contacts publics) et angles d’approche."
        )
        plan["sous_taches"] = st
        log("[korymb] Filet prospection : aucune sous-tâche reconnue — délégation automatique au Commercial.")

    _repair_plan_delegation_gaps(st, plan, mission_txt, root_mission_label, log)
    plan["sous_taches"] = st
    _materialize_subagents_when_plan_empty(st, plan, mission_txt, root_mission_label, log)
    plan["sous_taches"] = st

    for _rk in list(st.keys()):
        if _rk in agents_def() and _rk != "coordinateur":
            st[_rk] = _tache_to_str(st.get(_rk))

    # En chat, le plan JSON du CIO peut contenir une « sous-tâche » commerciale remplie mais
    # méta-narrative (le modèle joue l'orchestration) : l'injection ne s'applique pas car la clé
    # n'est pas vide — on impose alors une consigne exploitable pour chaque rôle nommé par le dirigeant.
    if chat_mode:
        blob_chat = _ascii_fold(f"{mission_txt}\n{root_mission_label}")
        ctx_chat = (root_mission_label or mission_txt or "").strip()
        if len(ctx_chat) > 2200:
            ctx_chat = ctx_chat[:2200] + "…"
        for role in _mentioned_sub_agents(blob_chat):
            if role not in agents_def() or role == "coordinateur":
                continue
            st[role] = (
                "Le dirigeant parle au CIO dans le chat ; le CIO te sollicite sur ce tour.\n"
                "Obligation : réponds en français avec un contenu **actionnable** que le CIO pourra recopier tel quel "
                "au dirigeant ; pas de message à un collègue imaginaire, pas de mise en scène du type "
                "« je te confie la mission » ou « récupère l'heure » sans donner l'heure.\n"
                "Si la question est factuelle (ex. l'heure civile) : réponds factuellement "
                "(fuseau Europe/Paris par défaut, format 24 h) dans ta réponse.\n\n"
                + ctx_chat
            )
            log(
                f"[korymb] Chat : consigne prioritaire pour {agents_def()[role]['label']} "
                "(rôle nommé par le dirigeant).",
            )
        plan["sous_taches"] = st

    delegated = [
        k
        for k in st
        if k in agents_def()
        and k != "coordinateur"
        and _tache_to_str(st.get(k)).strip()
    ]
    if delegated:
        log(f"[korymb] Délégation réelle : {', '.join(agents_def()[k]['label'] for k in delegated)}")
        for k, desc in st.items():
            if k in agents_def() and _tache_to_str(desc).strip():
                ds = _tache_to_str(desc).strip()
                short = ds.replace("\n", " ")[:160]
                log(f"[korymb]   → {agents_def()[k]['label']} : {short}{'…' if len(ds) > 160 else ''}")
    else:
        log("[korymb] Délégation réelle : (aucun sous-agent) — le CIO répond seul sans commercial / CM / etc.")

    plan_public = {
        "agents": list(delegated),
        "synthese_attendue": str(plan.get("synthese_attendue") or "")[:800],
        "sous_taches": {
            k: (str(v)[:500] + ("…" if len(str(v)) > 500 else ""))
            for k, v in st.items()
            if k in agents_def() and k != "coordinateur"
        },
    }
    if job_id:
        active_jobs[job_id]["plan"] = plan_public
        _emit_job_event(job_id, "plan_parsed", "coordinateur", {"plan": plan_public})
        _emit_job_event(
            job_id,
            "delegation",
            "coordinateur",
            {"to": delegated, "solo_cio": len(delegated) == 0},
        )
        _persist_running_job_snapshot(job_id)

    if job_id and team_rows:
        team_rows[0]["status"] = "done"
        for k in delegated:
            if k not in agents_def():
                continue
            dtask = _tache_to_str(st.get(k)).strip().replace("\n", " ")[:220]
            team_rows.append({
                "key": k,
                "label": agents_def()[k]["label"],
                "status": "pending",
                "phase": "delegate",
                "detail": dtask or "(sous-tâche)",
            })
        pub_team()

    exec_agent_order: list[str] = []
    for k in delegatable_subagent_keys_ordered():
        if k in st and k in agents_def() and k != "coordinateur":
            exec_agent_order.append(k)
    for k in st:
        if k in agents_def() and k != "coordinateur" and k not in exec_agent_order:
            exec_agent_order.append(k)
    # region agent log
    _cio_ndjson_trace(
        cio_trace_run,
        "H1",
        "main.py:orchestrate_exec_order",
        "delegation_and_exec_order",
        {
            "delegated": delegated,
            "exec_agent_order": exec_agent_order,
            "st_keys": list(st.keys())[:24],
        },
    )
    # endregion

    resultats: dict[str, str] = {}
    chain_prev = "coordinateur"
    for agent_key in exec_agent_order:
        _raise_if_job_cancelled(job_id)
        tache = _tache_to_str(st.get(agent_key)).strip()
        if agent_key not in agents_def() or agent_key == "coordinateur":
            continue
        if not tache:
            log(
                f"[korymb] Sous-tâche ignorée pour {agents_def()[agent_key]['label']} ({agent_key}) : "
                f"consigne vide après normalisation — aucun tour LLM.",
            )
            # region agent log
            _cio_ndjson_trace(
                cio_trace_run,
                "H1",
                "main.py:orchestrate_skip_subagent",
                "subtask_skipped_no_llm",
                {"agent_key": agent_key, "tache_type": type(st.get(agent_key)).__name__},
            )
            # endregion
            continue
        if job_id:
            if chain_prev == "coordinateur":
                handoff_fr = (
                    f"Le CIO adresse une consigne au {agents_def()[agent_key]['label']} "
                    "(sous-mission issue du plan)."
                )
            else:
                handoff_fr = (
                    f"Après le livrable du {agents_def()[chain_prev]['label']}, "
                    f"le CIO enchaîne avec le {agents_def()[agent_key]['label']}."
                )
            _emit_job_event(
                job_id,
                "handoff",
                "coordinateur",
                {
                    "from": chain_prev,
                    "to": agent_key,
                    "mediator": "coordinateur",
                    "summary_fr": handoff_fr,
                },
            )
            assign_line = _human_dialogue_cio_assign(agent_key, tache, chain_prev)
            _emit_job_event(
                job_id,
                "team_dialogue",
                "coordinateur",
                {
                    "phase": "assign",
                    "to": agent_key,
                    "line_fr": assign_line,
                },
            )
            for row in team_rows:
                if row.get("key") == agent_key and row.get("phase") == "delegate":
                    row["status"] = "running"
                    break
            pub_team()
        else:
            assign_line = _human_dialogue_cio_assign(agent_key, tache, chain_prev)
        log(f"[korymb] [CIO → {agents_def()[agent_key]['label']}] {_clip_one_line(assign_line, 1400)}")
        log(f"[korymb] {agents_def()[agent_key]['label']} travaille...")
        if job_id:
            _persist_running_job_snapshot(job_id)
        if job_id:
            _emit_job_event(
                job_id,
                "instruction_delivered",
                agent_key,
                {
                    "from": "coordinateur",
                    "instruction_excerpt": tache.replace("\n", " ")[:400],
                    "summary_fr": (
                        f"Le {agents_def()[agent_key]['label']} a reçu la consigne du CIO et commence le traitement."
                    ),
                },
            )
            _emit_job_event(
                job_id,
                "sub_agent_working",
                agent_key,
                {
                    "phase": "llm_tools",
                    "summary_fr": f"{agents_def()[agent_key]['label']} : appels modèle / outils en cours…",
                },
            )
            _emit_job_event(
                job_id,
                "agent_turn_start",
                agent_key,
                {"task_preview": tache.replace("\n", " ")[:320]},
            )
        agent_sys = agents_def()[agent_key]["system"] + FLEUR_CONTEXT + _korymb_memory_prompt_for(
            agent_key, exclude_job_id=job_id
        )

        web_evidence_calls = 0

        def on_sub_tool(actor: str, tool_name: str, meta: dict):
            nonlocal web_evidence_calls
            if job_id and actor == agent_key:
                if agent_key == "commercial" and tool_name in _WEB_RESEARCH_TOOL_NAMES:
                    web_evidence_calls += 1
                elif agent_key == "developpeur" and tool_name in _DEV_WEB_RESEARCH_TOOL_NAMES:
                    web_evidence_calls += 1
            _emit_job_event(job_id, "tool_call", actor, meta)

        sub_user = (
            "Le **CIO** (coordinateur) te transmet cette sous-mission dans le cadre du plan d’équipe. "
            "Réponds **en français** avec un texte que le CIO pourra intégrer tel quel dans sa synthèse au dirigeant. "
            "Ton style : **comme en réunion avec le CIO** — naturel, direct, humain (tu peux tutoyer ou vouvoyer selon ce qui te semble cohérent avec le ton Élude In Art). "
            "Commence par une courte phrase de prise en charge (ton rôle), puis livre le fond. "
            "Si tu utilises des outils, termine toujours par un paragraphe de synthèse : pas de réponse uniquement "
            "constituée d’appels d’outils ou de données brutes sans phrases d’analyse.\n"
            "Pour une **information factuelle immédiate** (ex. l’heure civile) : donne la réponse claire dans ton "
            "message final (fuseau **Europe/Paris** par défaut si non précisé) ; ne laisse pas le CIO sans phrase "
            "exploitable.\n\n"
            f"Sous-mission : {tache}\n\nContexte de la mission globale : {root_mission_label}"
        )
        per_blob = f"{tache}\n{root_mission_label}\n{mission_txt}"
        need_commercial_web = agent_key == "commercial" and _blob_needs_commercial_web_evidence(per_blob)
        need_dev_web = agent_key == "developpeur" and _blob_needs_developer_web_evidence(per_blob)
        mandate_web = need_commercial_web or need_dev_web
        sub_user_final = sub_user
        if need_commercial_web:
            sub_user_final += _COMMERCIAL_WEB_MANDATE_SUFFIX
        elif need_dev_web:
            sub_user_final += _DEVELOPER_WEB_MANDATE_SUFFIX
        sub_agent_exc: str | None = None
        try:
            res, ti2, to2 = llm_turn_maybe_tools(
                agent_sys,
                sub_user_final,
                agents_def()[agent_key].get("tools"),
                job_logs,
                on_tool=on_sub_tool if job_id else None,
                tool_actor=agent_key,
                usage_job_id=job_id,
                usage_context=f"subagent:{agent_key}",
            )
            if mandate_web and not sub_agent_exc and web_evidence_calls == 0:
                repair_suffix = (
                    _REPAIR_WEB_TOOLS_SUFFIX if need_commercial_web else _REPAIR_DEV_WEB_TOOLS_SUFFIX
                )
                res2, tic2, toc2 = llm_turn_maybe_tools(
                    agent_sys,
                    sub_user_final + repair_suffix,
                    agents_def()[agent_key].get("tools"),
                    job_logs,
                    on_tool=on_sub_tool if job_id else None,
                    tool_actor=agent_key,
                    usage_job_id=job_id,
                    usage_context=f"subagent_repair:{agent_key}",
                )
                if (res2 or "").strip():
                    res = res2
                ti2 += tic2
                to2 += toc2
                if web_evidence_calls == 0:
                    log(
                        f"[korymb] {agents_def()[agent_key]['label']} : besoin web détecté, "
                        f"aucun appel web_search/read_webpage/search_linkedin après relance système.",
                    )
        except Exception as e:
            logger.exception("Sous-agent %s : exécution interrompue", agent_key)
            sub_agent_exc = type(e).__name__
            res = (
                f"Erreur technique pendant l'exécution du rôle {agents_def()[agent_key]['label']} : {e}\n"
                "Le CIO doit le signaler au dirigeant et proposer de relancer."
            )
            ti2, to2 = 0, 0
        if chat_mode and not (res or "").strip():
            blob_time = _ascii_fold(
                f"{tache}\n{root_mission_label or ''}\n{mission_txt or ''}",
            )
            if re.search(r"quelle\s+heure|what\s+time|l['\u2019]heure", blob_time):
                try:
                    paris = datetime.now(ZoneInfo("Europe/Paris"))
                    res = (
                        f"Heure actuelle (Europe/Paris) : {paris.strftime('%H:%M')} "
                        f"({paris.strftime('%Y-%m-%d')})."
                    )
                    log(
                        f"[korymb] Chat : réponse horaire de secours (fuseau Europe/Paris) "
                        f"pour {agents_def()[agent_key]['label']}.",
                    )
                except Exception:
                    pass
        # region agent log
        _cio_ndjson_trace(
            cio_trace_run,
            "H5" if sub_agent_exc else "H2",
            "main.py:orchestrate_sub_agent_llm",
            "sub_agent_llm_finished",
            {
                "agent_key": agent_key,
                "res_chars": len(res or ""),
                "tokens_in": ti2,
                "tokens_out": to2,
                "sub_agent_exc": sub_agent_exc,
            },
        )
        # endregion
        t_in += ti2
        t_out += to2
        _sync_active_job_tokens(job_id, t_in, t_out)
        resultats[agent_key] = res
        reply_plain = (res or "").strip() or "Je n’ai pas de réponse textuelle à te renvoyer pour l’instant."
        reply_line_fr = _clip_dialogue_public(reply_plain)
        log(f"[korymb] [{agents_def()[agent_key]['label']} → CIO] {_clip_one_line(reply_line_fr, 2000)}")
        if job_id:
            _emit_job_event(
                job_id,
                "agent_turn_done",
                agent_key,
                {
                    "output_preview": (res or "").replace("\n", " ")[:480],
                    "chars": len(res or ""),
                },
            )
            _emit_job_event(
                job_id,
                "team_dialogue",
                agent_key,
                {
                    "phase": "reply",
                    "to": "coordinateur",
                    "line_fr": reply_line_fr,
                },
            )
        if job_id:
            for row in team_rows:
                if row.get("key") == agent_key and row.get("phase") == "delegate":
                    row["status"] = "done"
                    break
            pub_team()
            _persist_running_job_snapshot(job_id)
        log(f"[korymb] {agents_def()[agent_key]['label']} — terminé.")
        chain_prev = agent_key

    if job_id and chain_prev != "coordinateur":
        _emit_job_event(
            job_id,
            "handoff",
            chain_prev,
            {
                "from": chain_prev,
                "to": "coordinateur",
                "mediator": "coordinateur",
                "summary_fr": (
                    f"Le {agents_def()[chain_prev]['label']} a terminé son tour ; "
                    "le CIO récupère les livrables pour analyse et synthèse."
                ),
            },
        )

    if job_id:
        team_rows.append({
            "key": "coordinateur",
            "label": agent_cfg["label"],
            "status": "running",
            "phase": "synth",
            "detail": "Synthèse finale pour le dirigeant",
        })
        pub_team()

    if job_id and resultats:
        wrap_line = _human_dialogue_cio_wrapup(list(resultats.keys()))
        _emit_job_event(
            job_id,
            "team_dialogue",
            "coordinateur",
            {"phase": "wrapup", "line_fr": wrap_line},
        )
        log(f"[korymb] [CIO → équipe] {_clip_one_line(wrap_line, 900)}")

    if job_id:
        _emit_job_event(job_id, "synthesis_start", "coordinateur", {"with_sub_results": bool(resultats)})
    _raise_if_job_cancelled(job_id)
    log("[korymb] CIO — synthèse finale (rédaction à partir des livrables / mission)...")
    if job_id:
        _persist_running_job_snapshot(job_id)
    chat_tail = (
        "\nRéponse pour un chat : concision, ton accessible, français, markdown léger si utile."
        if chat_mode
        else ""
    )
    synth_grounding = (
        "\n\nRègle de vérité : seuls les rôles listés dans « Contributions des agents » ont réellement travaillé. "
        "Ne dis jamais qu'un agent a fait des recherches web ou une tâche s'il n'apparaît pas dans ce bloc."
        if resultats
        else (
            "\n\nRègle de vérité : aucun sous-agent (commercial, CM, dev, compta) n'a exécuté de tâche pour cette mission. "
            "Ne prétends pas que le commercial ou un autre rôle a cherché sur Internet. Ne dis pas que tu « relances » un rôle "
            "ou que tu « attends sa réponse » : ce serait faux. "
            "Interdit : toute mise en scène entre parenthèses ou au théâtre du type « (En attente de la réponse du commercial) », "
            "« (À mon collègue le commercial) », etc. — le moteur n'exécute pas de dialogue fictif ; écris un rapport direct. "
            "Dis clairement que tu réponds seul ; "
            "si l'utilisateur voulait de la prospection web ou un test d'équipe, propose de reformuler pour que le plan inclue les bons rôles."
        )
    )
    if resultats:
        contributions = "\n\n".join([
            f"=== {agents_def()[k]['label']} ===\n{v}"
            for k, v in resultats.items()
        ])
        synthese_user = (
            f"Mission originale : {root_mission_label}\n\n"
            f"Contributions des agents (textes réels exécutés par le moteur, à ne pas ignorer) :\n{contributions}\n\n"
            "Obligation de forme : commence par une section « Réponses des rôles » avec un sous-paragraphe par rôle "
            "ci-dessus (reprends faits et formulations utiles, y compris si une réponse est courte ou partielle). "
            "Si une contribution est « (Aucune réponse textuelle.) », dis-le explicitement pour ce rôle. "
            "Si la mission demandait une **réponse factuelle directe** (ex. l’heure), recopie-la explicitement "
            "depuis la contribution du rôle concerné — le dirigeant doit la voir sans deviner. "
            "Ensuite seulement, produis ta synthèse décisionnelle structurée et actionnable pour le dirigeant."
        )
        result, ti3, to3 = llm_turn(
            system_prompt + chat_tail + synth_grounding,
            synthese_user,
            max_tokens=2048 if chat_mode else 4096,
            or_profile="standard",
            usage_job_id=job_id,
            usage_context="cio_synthesis",
        )
    else:
        result, ti3, to3 = llm_turn(
            system_prompt + chat_tail + synth_grounding,
            mission_txt,
            max_tokens=2048 if chat_mode else 4096,
            or_profile="standard",
            usage_job_id=job_id,
            usage_context="cio_synthesis",
        )
    t_in += ti3
    t_out += to3
    _sync_active_job_tokens(job_id, t_in, t_out)

    if resultats:
        ann = _team_livrables_markdown_annex(resultats)
        if ann:
            result = ((result or "").rstrip() + ann) if (result or "").strip() else (result or "") + ann
            if job_id and job_id in active_jobs:
                active_jobs[job_id]["result"] = result

    if job_id:
        _emit_job_event(
            job_id,
            "synthesis_done",
            "coordinateur",
            {"output_preview": (result or "").replace("\n", " ")[:480], "chars": len(result or "")},
        )
        ev_list = active_jobs[job_id].get("events") or []
        if not isinstance(ev_list, list):
            ev_list = []
        war = _compute_delivery_warnings(
            resultats=resultats,
            sous_taches=st,
            events=ev_list,
            root_mission_label=root_mission_label,
            mission_txt=mission_txt,
        )
        _emit_job_event(
            job_id,
            "delivery_review",
            "coordinateur",
            {"warnings": war, "level": "warn" if war else "ok"},
        )

    if job_id and team_rows:
        for row in reversed(team_rows):
            if row.get("phase") == "synth":
                row["status"] = "done"
                break
        pub_team()

    if job_id:
        _emit_job_event(
            job_id,
            "mission_done",
            "coordinateur",
            {"tokens_in": t_in, "tokens_out": t_out},
        )

    # region agent log
    _cio_ndjson_trace(
        cio_trace_run,
        "H3",
        "main.py:orchestrate_return",
        "synthesis_complete_returning",
        {
            "result_chars": len(result or ""),
            "resultats_keys": list(resultats.keys()),
            "per_agent_result_chars": {k: len(resultats.get(k) or "") for k in resultats},
        },
    )
    # endregion
    if job_id and job_id in active_jobs:
        active_jobs[job_id]["result"] = result if isinstance(result, str) else ""
    return result, t_in, t_out


# ── Modèles Pydantic ──────────────────────────────────────────────────────────
class MissionRunConfig(BaseModel):
    """Options de lancement (QG / mission guidée) — persistantes sur le job."""

    model_config = ConfigDict(extra="ignore")
    recursive_refinement_enabled: bool = False
    recursive_max_rounds: int = Field(default=0, ge=0, le=12)
    require_user_validation: bool = True


class MissionRequest(BaseModel):
    """Lancer une mission, ou (si user_validate_job_id) valider une mission déjà terminée — même POST /run pour les proxys stricts."""

    model_config = ConfigDict(extra="ignore")

    mission: str = ""
    agent: str = "coordinateur"
    context: dict | None = None
    mission_config: MissionRunConfig | None = None
    user_validate_job_id: str | None = None
    remove_mission_session_id: str | None = Field(
        default=None,
        description="Avec mission vide : supprime cette session de cadrage (même POST /run, utile si seul /run est autorisé).",
    )

class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message: str
    agent: str = "coordinateur"
    history: list[dict] = []
    linked_job_id: str | None = None

class MissionResponse(BaseModel):
    status: str
    job_id: str
    agent: str
    user_validated_at: str | None = None


class MissionSessionCreate(BaseModel):
    agent: str = "coordinateur"
    title: str = ""
    initial_message: str | None = None


class MissionSessionMessageBody(BaseModel):
    message: str


class MissionSessionValidateBody(BaseModel):
    """Si renseigné, remplace la synthèse automatique de la consigne finale."""
    model_config = ConfigDict(extra="ignore")

    brief: str | None = None
    mission_config: MissionRunConfig | None = None


class RemoveJobPayload(BaseModel):
    job_id: str


class RemoveMissionSessionPayload(BaseModel):
    session_id: str


class ValidateMissionPayload(BaseModel):
    job_id: str


class EnterpriseMemoryPut(BaseModel):
    """Mise à jour partielle des contextes persistés (clés : global, commercial, …)."""

    model_config = ConfigDict(extra="ignore")

    contexts: dict[str, str] | None = None


class AdminAgentUpsertBody(BaseModel):
    """Création ou mise à jour d'un agent métier personnalisé (clé dans l'URL)."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(..., min_length=1, max_length=160)
    role: str = Field("", max_length=400)
    system: str = Field(..., min_length=1, max_length=32000)
    tools: list[str] = Field(default_factory=list)


class AdminSettingsPut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    llm_provider: str | None = None
    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    openrouter_api_key: str | None = None
    openrouter_model: str | None = None
    openrouter_base_url: str | None = None
    openrouter_http_referer: str | None = None
    openrouter_app_title: str | None = None
    llm_price_input_per_million_usd: float | None = None
    llm_price_output_per_million_usd: float | None = None
    llm_tiers_json: str | None = None


# ── Auth ──────────────────────────────────────────────────────────────────────
api_key_header = APIKeyHeader(name="X-Agent-Secret", auto_error=True)
def verify_secret(key: str = Depends(api_key_header)) -> str:
    if key != settings.agent_api_secret:
        raise HTTPException(status_code=403, detail="Secret invalide.")
    return key


def _format_exc_for_user(exc: BaseException, *, max_len: int = 7200) -> str:
    msg = str(exc).strip() or type(exc).__name__
    if len(msg) > max_len:
        return msg[: max_len - 3] + "..."
    return msg


def _user_visible_job_failure_markdown(exc: BaseException) -> str:
    """Contenu `jobs.result` + panneau mission quand l'exécution échoue."""
    detail = _format_exc_for_user(exc)
    return (
        "## Échec de la mission\n\n"
        f"**Cause :** {detail}\n\n"
        "Consulte le **journal d'exécution** (section repliable) pour la trace complète. "
        "Si le message évoque une **clé API**, un **modèle** ou un **quota**, ouvre **Administration → LLM**, "
        "corrige la configuration, puis relance."
    )


def _user_visible_chat_sync_failure_text(exc: BaseException) -> str:
    """Réponse HTTP /chat synchrone (sans job d'arrière-plan)."""
    detail = _format_exc_for_user(exc, max_len=4000)
    return (
        "Impossible d'obtenir une réponse du modèle pour ce message.\n\n"
        f"**Détail :** {detail}\n\n"
        "Vérifie la configuration LLM (fournisseur, clé, modèle, quotas) ou réessaie plus tard."
    )


# ── État en mémoire ────────────────────────────────────────────────────────────
active_jobs: dict[str, dict] = {}
daily_tokens: dict[str, dict] = {}

KORYMB_MAX_REFINEMENT_ROUNDS = 12


class KorymbJobCancelled(Exception):
    """Annulation demandée par l'utilisateur (POST /jobs/{id}/cancel)."""


def _raise_if_job_cancelled(job_id: str | None) -> None:
    if job_id and job_id in active_jobs and active_jobs[job_id].get("cancel_requested"):
        raise KorymbJobCancelled()


def _emit_job_event(job_id: str | None, typ: str, agent: str | None = None, payload: dict | None = None) -> None:
    """Append-only : prêt pour export NDJSON / bus async plus tard."""
    if not job_id or job_id not in active_jobs:
        # region agent log
        if typ in (
            "delegation",
            "instruction_delivered",
            "agent_turn_done",
            "synthesis_done",
            "mission_done",
            "orchestration_start",
        ):
            _cio_ndjson_trace(
                "emit_orphan",
                "H4",
                "main.py:_emit_job_event",
                "job_event_not_stored",
                {
                    "typ": typ,
                    "agent": agent,
                    "has_job_id": bool(job_id),
                    "in_active_jobs": job_id in active_jobs if job_id else False,
                },
            )
        # endregion
        return
    ev = make_event(typ, agent, payload)
    active_jobs[job_id].setdefault("events", []).append(ev)
    if typ == "team_dialogue":
        pl = payload if isinstance(payload, dict) else {}
        line = str(pl.get("line_fr") or "").strip()
        if line:
            phase = str(pl.get("phase") or "dialogue").strip()[:24] or "dialogue"
            src = f"orchestration_{phase}"[:32]
            ag = (agent or "coordinateur")[:32]
            try:
                append_job_mission_thread(
                    job_id,
                    role="assistant",
                    agent=ag,
                    content=line[:12000],
                    source=src,
                )
            except Exception:
                logger.exception("append_job_mission_thread (team_dialogue → journal mission)")


def _publish_team(job_id: str | None, rows: list[dict]) -> None:
    """Expose qui travaille sur la mission (UI + persistance via update_job)."""
    if not job_id or job_id not in active_jobs:
        return
    active_jobs[job_id]["team"] = [{**r} for r in rows]


def _parse_team_field(j: dict) -> list:
    t = j.get("team")
    if isinstance(t, list):
        return t
    tr = j.get("team_trace")
    if isinstance(tr, str):
        try:
            return json.loads(tr or "[]")
        except Exception:
            return []
    return []

def _today() -> str:
    return date.today().isoformat()

def _add_daily(t_in: int, t_out: int):
    today = _today()
    if today not in daily_tokens:
        daily_tokens[today] = {"in": 0, "out": 0}
    daily_tokens[today]["in"]  += t_in
    daily_tokens[today]["out"] += t_out


def _sync_active_job_tokens(job_id: str | None, t_in: int, t_out: int) -> None:
    """Met à jour les compteurs côté job en cours (polling UI /jobs et /jobs/{id})."""
    if not job_id or job_id not in active_jobs:
        return
    active_jobs[job_id]["tokens_in"] = int(t_in)
    active_jobs[job_id]["tokens_out"] = int(t_out)


def _tokens_inflight() -> int:
    return sum(
        int(j.get("tokens_in", 0)) + int(j.get("tokens_out", 0))
        for j in active_jobs.values()
        if j.get("status") == "running"
    )


def _lifetime_tokens_total() -> int:
    base = sum_jobs_tokens_total()
    extra = 0
    for jid, job in active_jobs.items():
        live = int(job.get("tokens_in", 0)) + int(job.get("tokens_out", 0))
        row = db_get_job(jid)
        db_t = 0
        if row:
            db_t = int(row.get("tokens_in", 0)) + int(row.get("tokens_out", 0))
        extra += max(0, live - db_t)
    return base + extra


def _planning_system(agent_key: str) -> str:
    base = agents_def().get(agent_key, agents_def()["coordinateur"])["system"] + FLEUR_CONTEXT
    if agent_key == "coordinateur":
        return base + MODE_CADRAGE_CIO
    return base + MODE_CADRAGE_AGENT + SUB_AGENT_COORDINATION_FR


def _session_messages_for_llm(messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in messages[-24:]:
        if m.get("role") not in ("user", "assistant"):
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            out.append({"role": m["role"], "content": c})
    return out


def _session_planning_llm_turn(session: dict) -> tuple[str, int, int]:
    system = _planning_system(session["agent"])
    msgs = _session_messages_for_llm(session["messages"])
    if not msgs:
        return "(Aucun message à traiter.)", 0, 0
    return llm_chat(
        system,
        msgs,
        max_tokens=2048,
        or_profile="lite",
        usage_context="mission_session_planning",
    )


def _mission_config_from_payload(raw: MissionRunConfig | dict | None) -> dict:
    if raw is None:
        return MissionRunConfig().model_dump()
    if isinstance(raw, MissionRunConfig):
        return raw.model_dump()
    if isinstance(raw, dict):
        try:
            return MissionRunConfig(**raw).model_dump()
        except Exception:
            return MissionRunConfig().model_dump()
    return MissionRunConfig().model_dump()


def _cio_refinement_round_mission(
    job_id: str,
    mission_txt_base: str,
    mission_plain: str,
    current_result: str,
    round_idx: int,
    job_logs: list | None,
) -> tuple[str, int, int]:
    """
    Boucle d'exécution (aussi appelée boucle d'affinage) : critique CIO puis, si besoin,
    **nouvelle** orchestration (plan JSON → sous-agents concernés → synthèse), pour plusieurs
    allers-retours CIO ↔ équipe au lieu d'une simple réécriture du texte final.
    """
    _raise_if_job_cancelled(job_id)
    crit_sys = agents_def()["coordinateur"]["system"] + FLEUR_CONTEXT
    critique, ti1, to1 = llm_turn(
        crit_sys + "\n\nRéponds de façon compacte, sans formules de politesse.",
        f"Mission initiale (rappel) :\n{(mission_plain or '')[:3500]}\n\n"
        f"Synthèse actuelle (boucle d'exécution, tour {round_idx}) :\n{(current_result or '')[:12000]}\n\n"
        "Liste au maximum 5 lacunes, risques ou oublis par rapport à la mission. "
        "Une ligne par point, numérotée. Si la synthèse est déjà pleinement satisfaisante, réponds uniquement : RAS",
        max_tokens=900,
        or_profile="lite",
        usage_job_id=job_id,
        usage_context="cio_refinement_critique",
    )
    t_in, t_out = ti1, to1
    if job_logs is not None:
        job_logs.append(f"[korymb] Boucle d'affinage CIO — tour {round_idx} analyse ({ti1}↑{to1}↓ tok).")
    _emit_job_event(
        job_id,
        "refinement_round",
        "coordinateur",
        {"round": round_idx, "phase": "critique", "critique_preview": (critique or "").replace("\n", " ")[:420]},
    )
    crit_stripped = (critique or "").strip()
    if crit_stripped.upper().startswith("RAS") and len(crit_stripped) < 160:
        if job_logs is not None:
            job_logs.append(f"[korymb] Boucle d'affinage CIO — tour {round_idx} : RAS, pas de nouvelle passe équipe.")
        return current_result, t_in, t_out

    suffix = (
        f"\n\n--- Boucle d'exécution (affinage) : tour {round_idx} (même mission, poursuite du job) ---\n"
        f"Synthèse actuelle du CIO à améliorer :\n{(current_result or '')[:10000]}\n\n"
        f"Lacunes et correctifs identifiés (à traiter) :\n{(critique or '')[:6500]}\n\n"
        "Produis un plan JSON **minimal** : ne relance que les rôles nécessaires pour combler ces points "
        "(ex. commercial pour une recherche web ou des contacts ; developpeur pour une vérif technique ; "
        "comptable pour des ordres de grandeur ; community_manager pour un angle réseaux / contenu). "
        "Si une simple réécriture de synthèse suffit sans nouveau travail de terrain, "
        'mets "agents": [] et "sous_taches": {} — tu finaliseras alors seul à partir du contexte ci-dessus.'
    )
    if job_logs is not None:
        job_logs.append(f"[korymb] Boucle d'exécution — tour {round_idx} : replanification et exécution équipe (si le plan le prévoit).")
    _emit_job_event(
        job_id,
        "refinement_round",
        "coordinateur",
        {
            "round": round_idx,
            "phase": "orchestrate",
            "summary_fr": "Boucle d'exécution : nouvelle passe plan / sous-agents / synthèse.",
        },
    )
    _raise_if_job_cancelled(job_id)
    improved, ti2, to2 = orchestrate_coordinateur_mission(
        f"{mission_txt_base}{suffix}",
        mission_plain,
        job_logs,
        chat_mode=False,
        job_id=job_id,
    )
    t_in += ti2
    t_out += to2
    _emit_job_event(
        job_id,
        "refinement_round",
        "coordinateur",
        {
            "round": round_idx,
            "phase": "synthesis",
            "output_preview": (improved or "").replace("\n", " ")[:420],
        },
    )
    if job_logs is not None:
        job_logs.append(f"[korymb] Boucle d'exécution — tour {round_idx} orchestration terminée ({ti2}↑{to2}↓ tok).")
    return (improved or current_result).strip(), t_in, t_out


def _compose_mission_brief_from_session(session: dict, brief_override: str | None) -> str:
    if brief_override and str(brief_override).strip():
        return str(brief_override).strip()
    msgs = session.get("messages") or []
    conv_lines: list[str] = []
    for m in msgs:
        if m.get("role") not in ("user", "assistant"):
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            conv_lines.append(f"{m['role']}: {c[:4000]}")
    if not conv_lines:
        raise HTTPException(status_code=400, detail="Échange vide : envoie au moins un message avant validation.")
    conv = "\n".join(conv_lines)
    synopsis, ti, to = llm_turn(
        "Tu rédiges une consigne de mission unique, opérationnelle, en français.",
        "À partir de cet échange de cadrage, produis la consigne DÉFINITIVE qui sera exécutée par l'équipe "
        "(objectifs, périmètre, critères de succès si utile). Pas de titre markdown, pas de préambule.\n\n---\n"
        f"{conv}\n---",
        max_tokens=1400,
        or_profile="lite",
        usage_context="mission_session_brief",
    )
    _add_daily(ti, to)
    return synopsis.strip()


def _append_session_exchange_for_delegation(session: dict, mission_plain: str, max_chars: int = 9000) -> str:
    """
    Le brief auto peut omettre des formulations du dirigeant (« au commercial », etc.).
    On annexe les messages de cadrage pour que la détection des rôles et les filets voient le même vocabulaire que l’UI.
    """
    msgs = session.get("messages") or []
    lines: list[str] = []
    for m in msgs[-30:]:
        if m.get("role") not in ("user", "assistant"):
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            lines.append(f"{m['role']}: {c.strip()[:3500]}")
    if not lines:
        return mission_plain
    conv = "\n".join(lines)
    if len(conv) > max_chars:
        conv = conv[:max_chars] + "\n…"
    return (
        f"{mission_plain}\n\n"
        "--- Référence : échanges de cadrage (formulations du dirigeant, noms de rôles) ---\n"
        f"{conv}"
    )


def _schedule_mission_execution(
    background_tasks: BackgroundTasks,
    job_id: str,
    agent_key: str,
    mission_plain: str,
    context: dict | None,
    source_tag: str,
    mission_config: dict | None = None,
) -> None:
    job_logs: list[str] = []
    requested_agent_key = agent_key
    agent_cfg = agents_def().get(agent_key, agents_def()["coordinateur"])
    now_iso = datetime.utcnow().isoformat()
    cfg = _mission_config_from_payload(mission_config)
    if cfg.get("recursive_refinement_enabled"):
        try:
            rr = int(cfg.get("recursive_max_rounds") or 0)
        except (TypeError, ValueError):
            rr = 0
        if rr < 1:
            cfg = {**cfg, "recursive_max_rounds": 1}
        if agent_key != "coordinateur":
            agent_key = "coordinateur"
            agent_cfg = agents_def()["coordinateur"]
    active_jobs[job_id] = {
        "status": "running",
        "agent": agent_key,
        "mission": mission_plain,
        "result": None,
        "logs": job_logs,
        "tokens_in": 0,
        "tokens_out": 0,
        "team": [],
        "events": [],
        "plan": {},
        "source": source_tag,
        "created_at": now_iso,
        "mission_config": cfg,
    }
    save_job(job_id, agent_key, mission_plain, source=source_tag, mission_config=cfg)
    mem = _korymb_memory_prompt_for(agent_key, exclude_job_id=job_id)
    sub_coord = SUB_AGENT_COORDINATION_FR if agent_key != "coordinateur" else ""
    system_prompt = agent_cfg["system"] + FLEUR_CONTEXT + mem + sub_coord
    context_str = f"\n\nContexte : {json.dumps(context, ensure_ascii=False)}" if context else ""
    mission_txt = f"{mission_plain}{context_str}"

    def execute():
        job_logs.append(f"[korymb] Mission démarrée — {agent_cfg['label']}")
        cfg = active_jobs.get(job_id, {}).get("mission_config") or _mission_config_from_payload(None)
        if cfg.get("recursive_refinement_enabled"):
            job_logs.append(
                f"[korymb] Config : boucle d'affinage CIO + équipe activée "
                f"({int(cfg.get('recursive_max_rounds') or 0)} tour(s) max) — "
                "chaque tour peut relancer des sous-agents selon le plan."
            )
            if requested_agent_key != "coordinateur":
                ra = agents_def().get(requested_agent_key, agents_def()["coordinateur"])
                job_logs.append(
                    f"[korymb] Agent de cadrage / demandé : {ra['label']} — exécution des boucles via le CIO "
                    "(orchestration multi-rôles)."
                )
        if not cfg.get("require_user_validation", True):
            job_logs.append("[korymb] Config : pas de validation dirigeant requise en fin de mission.")
        _emit_job_event(
            job_id,
            "mission_start",
            agent_key,
            {
                "label": agent_cfg["label"],
                "preview": (mission_plain or "")[:240],
                "mission_config": cfg,
            },
        )
        t_in_total = t_out_total = 0
        result = ""
        try:
            if agent_key == "coordinateur":
                result, t_in_total, t_out_total = orchestrate_coordinateur_mission(
                    mission_txt, mission_plain, job_logs, chat_mode=False, job_id=job_id,
                )
                _raise_if_job_cancelled(job_id)
                if cfg.get("recursive_refinement_enabled"):
                    try:
                        mx = int(cfg.get("recursive_max_rounds") or 0)
                    except (TypeError, ValueError):
                        mx = 0
                    mx = max(1, min(KORYMB_MAX_REFINEMENT_ROUNDS, mx))
                    for r in range(1, mx + 1):
                        _raise_if_job_cancelled(job_id)
                        result, ti_r, to_r = _cio_refinement_round_mission(
                            job_id, mission_txt, mission_plain, result, r, job_logs,
                        )
                        t_in_total += ti_r
                        t_out_total += to_r
                        _sync_active_job_tokens(job_id, t_in_total, t_out_total)
            else:
                active_jobs[job_id]["team"] = [{
                    "key": agent_key,
                    "label": agent_cfg["label"],
                    "status": "running",
                    "phase": "work",
                    "detail": (mission_plain or "")[:220],
                }]
                job_logs.append(f"[korymb] {agent_cfg['label']} travaille...")
                _raise_if_job_cancelled(job_id)

                def on_tool(actor: str, tool_name: str, meta: dict):
                    _emit_job_event(job_id, "tool_call", actor, meta)

                result, t_in_total, t_out_total = llm_turn_maybe_tools(
                    system_prompt,
                    mission_txt,
                    agent_cfg.get("tools"),
                    job_logs,
                    on_tool=on_tool,
                    tool_actor=agent_key,
                    usage_job_id=job_id,
                    usage_context=f"single_agent:{agent_key}",
                )
                if job_id in active_jobs and active_jobs[job_id].get("team"):
                    active_jobs[job_id]["team"][0]["status"] = "done"

            _add_daily(t_in_total, t_out_total)
            if job_id in active_jobs:
                active_jobs[job_id].update({
                    "status": "completed", "result": result,
                    "tokens_in": t_in_total, "tokens_out": t_out_total,
                })
            job_logs.append(f"[korymb] Terminé — {t_in_total}↑ {t_out_total}↓ tokens.")
            if not cfg.get("require_user_validation", True):
                job_logs.append(
                    "[korymb] Mission auto-clôturée (validation dirigeant désactivée dans la config).",
                )
            team_snap = active_jobs.get(job_id, {}).get("team", [])
            plan_snap = active_jobs.get(job_id, {}).get("plan") or {}
            events_snap = active_jobs.get(job_id, {}).get("events") or []
            src = active_jobs.get(job_id, {}).get("source") or source_tag
            update_job(
                job_id,
                "completed",
                result,
                job_logs,
                t_in_total,
                t_out_total,
                team_trace=team_snap,
                plan=plan_snap,
                events=events_snap,
                source=src,
                mission_config=cfg,
            )
            try:
                append_recent_mission(
                    job_id,
                    mission_plain,
                    (result or "") if isinstance(result, str) else "",
                )
            except Exception:
                logger.exception("append_recent_mission")
            if not cfg.get("require_user_validation", True):
                job_set_user_validated(job_id)
                row_uv = db_get_job(job_id)
                uv = row_uv.get("user_validated_at") if row_uv else None
                if job_id in active_jobs and uv:
                    active_jobs[job_id]["user_validated_at"] = uv
                    active_jobs[job_id]["mission_closed_by_user"] = True
            logger.info("Job [%s] OK — %d tokens.", job_id, t_in_total + t_out_total)

        except KorymbJobCancelled:
            job_logs.append("[korymb] Mission interrompue — arrêt demandé par l'utilisateur.")
            _emit_job_event(job_id, "mission_cancelled", None, {"reason": "user_cancel"})
            snap = active_jobs.get(job_id, {})
            res_partial = snap.get("result") if isinstance(snap.get("result"), str) else None
            final_text = (res_partial or "").strip() or (
                "## Mission interrompue\n\n"
                "L'exécution a été **stoppée sur demande**. "
                "Aucun livrable final n'a été consolidé ; tu peux relancer une mission ou reprendre depuis l'historique."
            )
            if job_id in active_jobs:
                active_jobs[job_id].update({
                    "status": "cancelled",
                    "result": final_text,
                    "tokens_in": t_in_total,
                    "tokens_out": t_out_total,
                })
            team_snap = active_jobs.get(job_id, {}).get("team", [])
            plan_snap = active_jobs.get(job_id, {}).get("plan") or {}
            events_snap = active_jobs.get(job_id, {}).get("events") or []
            src = active_jobs.get(job_id, {}).get("source") or source_tag
            update_job(
                job_id,
                "cancelled",
                final_text,
                job_logs,
                t_in_total,
                t_out_total,
                team_trace=team_snap,
                plan=plan_snap,
                events=events_snap,
                source=src,
                mission_config=active_jobs.get(job_id, {}).get("mission_config"),
            )
            logger.info("Job [%s] annulé par l'utilisateur.", job_id)

        except Exception as e:
            user_result = _user_visible_job_failure_markdown(e)
            if job_id in active_jobs:
                active_jobs[job_id].update({"status": f"error: {e}", "result": user_result})
            job_logs.append(f"[korymb] Erreur : {e}")
            _emit_job_event(job_id, "error", None, {"message": str(e)[:500]})
            team_snap = active_jobs.get(job_id, {}).get("team", [])
            plan_snap = active_jobs.get(job_id, {}).get("plan") or {}
            events_snap = active_jobs.get(job_id, {}).get("events") or []
            src = active_jobs.get(job_id, {}).get("source") or source_tag
            update_job(
                job_id,
                f"error: {e}",
                user_result,
                job_logs,
                t_in_total,
                t_out_total,
                team_trace=team_snap,
                plan=plan_snap,
                events=events_snap,
                source=src,
                mission_config=active_jobs.get(job_id, {}).get("mission_config"),
            )
            logger.error("Job [%s] échoué : %s", job_id, e)

    background_tasks.add_task(execute)


# ── App FastAPI ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Korymb backend démarré — build %s", BACKEND_VERSION)
    yield
    logger.info("Korymb backend arrêté — build %s", BACKEND_VERSION)

app = FastAPI(title="Korymb — Moteur Agentique", version=BACKEND_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.env == "development" else [
        "https://korymb.eludein.art",
        "http://korymb.eludein.art",
        "https://api-korymb.eludein.art",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Korymb-Version"],
)


@app.middleware("http")
async def korymb_version_header_middleware(request, call_next):
    response = await call_next(request)
    response.headers["X-Korymb-Version"] = BACKEND_VERSION
    return response


def _env_is_set(name: str) -> bool:
    return bool(str(os.getenv(name, "")).strip())


def _probe_tcp(host: str, port: int, timeout_s: float = 2.5) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout_s):
            return True, "reachable"
    except Exception as e:
        return False, str(e)


def _system_metrics_snapshot() -> dict:
    now = time.time()
    out: dict[str, object] = {
        "process_uptime_s": max(0, int(now - _PROCESS_STARTED_AT)),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpu_count": os.cpu_count() or 1,
    }
    try:
        import psutil  # type: ignore

        vm = psutil.virtual_memory()
        out["memory"] = {
            "total_bytes": int(vm.total),
            "available_bytes": int(vm.available),
            "used_percent": float(vm.percent),
        }
        out["cpu_percent"] = float(psutil.cpu_percent(interval=0.15))
    except Exception:
        out["memory"] = {}
        out["cpu_percent"] = None

    try:
        disk_root = str(Path.cwd().anchor or "/")
        du = shutil.disk_usage(disk_root)
        out["disk"] = {
            "path": disk_root,
            "total_bytes": int(du.total),
            "free_bytes": int(du.free),
            "used_percent": round((float(du.used) / float(du.total) * 100.0), 2) if du.total else 0.0,
        }
    except Exception:
        out["disk"] = {}
    return out


def _integration_health_snapshot(*, refresh_tools: bool) -> dict:
    from tools_health import probe_tools_health

    tools_probe = probe_tools_health(force=bool(refresh_tools))
    cfg = merge_with_env()

    status: dict[str, dict[str, object]] = {
        "llm_openrouter": {
            "configured": _env_is_set("OPENROUTER_API_KEY"),
            "provider_selected": str(cfg.get("llm_provider") or "") == "openrouter",
        },
        "llm_anthropic": {
            "configured": _env_is_set("ANTHROPIC_API_KEY"),
            "provider_selected": str(cfg.get("llm_provider") or "") == "anthropic",
        },
        "google_oauth": {
            "configured": _env_is_set("GOOGLE_API_ACCESS_TOKEN")
            or (
                _env_is_set("GOOGLE_OAUTH_REFRESH_TOKEN")
                and _env_is_set("GOOGLE_OAUTH_CLIENT_ID")
                and _env_is_set("GOOGLE_OAUTH_CLIENT_SECRET")
            ),
        },
        "google_drive": {
            "configured": (
                _env_is_set("GOOGLE_DRIVE_ACCESS_TOKEN")
                or _env_is_set("GOOGLE_API_ACCESS_TOKEN")
                or (
                    _env_is_set("GOOGLE_OAUTH_REFRESH_TOKEN")
                    and _env_is_set("GOOGLE_OAUTH_CLIENT_ID")
                    and _env_is_set("GOOGLE_OAUTH_CLIENT_SECRET")
                )
            ),
            "folder_id_set": _env_is_set("GOOGLE_DRIVE_FOLDER_ID"),
        },
        "facebook": {
            "configured": _env_is_set("FACEBOOK_ACCESS_TOKEN") and _env_is_set("FACEBOOK_PAGE_ID"),
        },
        "instagram": {
            "configured": _env_is_set("INSTAGRAM_ACCESS_TOKEN") and _env_is_set("INSTAGRAM_ACCOUNT_ID"),
        },
        "smtp": {
            "configured": _env_is_set("SMTP_HOST") and _env_is_set("SMTP_USER") and _env_is_set("SMTP_PASS"),
        },
        "fleur_db": {
            "configured": _env_is_set("FLEUR_DB_HOST") and _env_is_set("FLEUR_DB_USER"),
        },
        "web_tools": {
            "configured": True,
            "ok": bool(tools_probe.get("web_search", {}).get("ok")) and bool(tools_probe.get("read_webpage", {}).get("ok")),
        },
    }

    # Probes réseau légères : best-effort, sans provoquer d'échec global.
    smtp_host = str(os.getenv("SMTP_HOST", "")).strip()
    if smtp_host:
        ok, detail = _probe_tcp(smtp_host, 465)
        status["smtp"]["reachable"] = ok
        status["smtp"]["probe_detail"] = detail[:160]

    try:
        from db_fleur import _get_conn  # type: ignore

        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                _ = cur.fetchone()
        status["fleur_db"]["reachable"] = True
    except Exception as e:
        status["fleur_db"]["reachable"] = False
        status["fleur_db"]["probe_detail"] = str(e)[:180]

    configured = 0
    reachable = 0
    for v in status.values():
        if bool(v.get("configured")):
            configured += 1
        if bool(v.get("ok")) or bool(v.get("reachable")):
            reachable += 1
    return {
        "integrations": status,
        "tools_probe": tools_probe,
        "summary": {
            "configured_count": configured,
            "reachable_count": reachable,
            "total_integrations": len(status),
        },
    }


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health(
    include_tools: bool = Query(
        False,
        description="Inclure la sonde outils web (DuckDuckGo + lecture HTTP) dans la réponse, clé « tools ».",
    ),
    refresh_tools: bool = Query(
        False,
        description="Forcer une nouvelle sonde (nécessite include_tools=true).",
    ),
):
    body: dict = {
        "status": "ok",
        "service": "korymb-backend",
        "version": BACKEND_VERSION,
        "revision": BACKEND_VERSION,
        "revision_at": BACKEND_REVISION_AT or None,
        # Aide au debug local : si la révision affichée ne suit pas ton repo, compare ce chemin
        # avec celui de ton clone (autre dossier / Docker / ancien venv = autre code).
        "code_dir": str(_KORYMB_BACKEND_DIR),
        # Si false côté client alors que le repo contient la feature : mauvais processus sur le port / image Docker ancienne.
        "mission_session_delete_routes": True,
    }
    if include_tools:
        from tools_health import probe_tools_health

        body["tools"] = probe_tools_health(force=bool(refresh_tools))
    return JSONResponse(
        content=body,
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Korymb-Version": BACKEND_VERSION,
        },
    )


@app.get("/admin/system-health", dependencies=[Depends(verify_secret)])
def admin_system_health(refresh_tools: bool = False):
    """État d'administration consolidé : tokens configurés, intégrations joignables, métriques système."""
    payload = {
        "status": "ok",
        "version": BACKEND_VERSION,
        "revision_at": BACKEND_REVISION_AT or None,
        "service": "korymb-backend",
        "system": _system_metrics_snapshot(),
        **_integration_health_snapshot(refresh_tools=bool(refresh_tools)),
    }
    return JSONResponse(
        content=payload,
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Korymb-Version": BACKEND_VERSION,
        },
    )


def _web_tools_probe_json(*, refresh: bool) -> JSONResponse:
    from tools_health import probe_tools_health

    return JSONResponse(
        content=probe_tools_health(force=bool(refresh)),
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Korymb-Version": BACKEND_VERSION,
        },
    )


@app.get("/health/tools")
def health_tools(refresh: bool = False):
    """
    Accessibilité recherche web (DuckDuckGo) et lecture HTTP — sans secret, pour le dashboard.
    Sonde mise en cache côté serveur (~2 min) ; ?refresh=true force une nouvelle sonde.
    """
    return _web_tools_probe_json(refresh=refresh)


@app.get("/probe/web-tools")
def probe_web_tools_endpoint(refresh: bool = False):
    """
    Même charge utile que /health/tools, chemin distinct : certains pare-feux ou proxies filtrent
    les sous-chemins de /health ou les paramètres de requête sur /health.
    """
    return _web_tools_probe_json(refresh=refresh)


@app.get("/agents")
def list_agents():
    ad = agents_def()
    return {
        "agents": [
            {
                "key": k,
                "label": v["label"],
                "role": v["role"],
                "tools": v.get("tools", []),
                "is_manager": v.get("is_manager", False),
                "builtin": k in BUILTIN_AGENT_DEFINITIONS,
            }
            for k, v in ad.items()
        ],
        "tool_tags": sorted(ALLOWED_AGENT_TOOL_TAGS),
    }


@app.get("/llm")
def llm_public_info():
    """Fournisseur et modèle actifs (sans clés) — pour affichage dashboard."""
    cfg = merge_with_env()
    provider = str(cfg.get("llm_provider") or "anthropic").strip().lower()
    if provider == "openrouter":
        model, tier_key, _, _ = resolve_openrouter_tier(cfg, "lite")
        payload = {
            "provider": "openrouter",
            "model": model,
            "model_fallback": cfg.get("openrouter_model"),
            "tier": tier_key,
            "base_url": cfg.get("openrouter_base_url"),
        }
        return JSONResponse(
            payload,
            headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": str(BACKEND_VERSION)},
        )
    payload = {"provider": "anthropic", "model": cfg.get("anthropic_model")}
    return JSONResponse(
        payload,
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": str(BACKEND_VERSION)},
    )


@app.get("/memory", dependencies=[Depends(verify_secret)])
def enterprise_memory_get():
    """Contexte entreprise + fil des missions récentes (SQLite)."""
    return get_enterprise_memory()


@app.put("/memory", dependencies=[Depends(verify_secret)])
def enterprise_memory_put(body: EnterpriseMemoryPut):
    """Fusionne les champs texte fournis ; ne supprime pas les clés omises."""
    if body.contexts:
        return merge_enterprise_contexts(dict(body.contexts))
    return get_enterprise_memory()


@app.get("/admin/settings", dependencies=[Depends(verify_secret)])
def admin_get_llm_settings():
    """Lecture config LLM effective (clés API masquées, flags *_set)."""
    return to_public_dict(merge_with_env())


@app.put("/admin/settings", dependencies=[Depends(verify_secret)])
def admin_put_llm_settings(body: AdminSettingsPut):
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    if "llm_provider" in data and str(data["llm_provider"]) not in ("anthropic", "openrouter"):
        raise HTTPException(status_code=400, detail="llm_provider doit être anthropic ou openrouter")
    try:
        merged = save_partial(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return to_public_dict(merged)


@app.get("/admin/agents", dependencies=[Depends(verify_secret)])
def admin_agents_definitions():
    """Définitions complètes (y compris prompts) + liste des tags d'outils autorisés."""
    ad = agents_def()
    return {
        "agents": [
            {
                "key": k,
                "label": v["label"],
                "role": v.get("role", ""),
                "system": v.get("system", ""),
                "tools": v.get("tools", []),
                "is_manager": v.get("is_manager", False),
                "builtin": k in BUILTIN_AGENT_DEFINITIONS,
            }
            for k, v in ad.items()
        ],
        "tool_tags": sorted(ALLOWED_AGENT_TOOL_TAGS),
    }


@app.put("/admin/agents/custom/{agent_key}", dependencies=[Depends(verify_secret)])
def admin_upsert_custom_agent(agent_key: str, body: AdminAgentUpsertBody):
    raw = (agent_key or "").strip()
    canon, err = validate_custom_agent_key(raw)
    if err:
        raise HTTPException(status_code=400, detail=err)
    try:
        upsert_custom_agent(
            canon,
            label=body.label,
            role=body.role,
            system_prompt=body.system,
            tools=body.tools,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    refresh_agents_definitions_cache()
    return {"ok": True, "key": canon}


@app.delete("/admin/agents/custom/{agent_key}", dependencies=[Depends(verify_secret)])
def admin_delete_custom_agent(agent_key: str):
    try:
        deleted = delete_custom_agent((agent_key or "").strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    refresh_agents_definitions_cache()
    return {"ok": True, "deleted": bool(deleted)}


def _tokens_payload() -> dict:
    today = _today()
    t = daily_tokens.get(today, {"in": 0, "out": 0})
    cfg = merge_with_env()
    cost = (
        t["in"] * float(cfg.get("llm_price_input_per_million_usd") or 0)
        + t["out"] * float(cfg.get("llm_price_output_per_million_usd") or 0)
    ) / 1_000_000
    usage = usage_cost_breakdown()
    tier_pub = tier_config_public(cfg)
    return {
        "today": today, "tokens_in": t["in"], "tokens_out": t["out"],
        "total": t["in"] + t["out"], "cost_usd": round(cost, 4),
        "alert": (t["in"] + t["out"]) >= settings.token_alert_threshold,
        "budget_exceeded": (t["in"] + t["out"]) >= settings.max_tokens_per_job * 10,
        "max_per_job": settings.max_tokens_per_job,
        "alert_threshold": settings.token_alert_threshold,
        "lifetime_tokens_total": _lifetime_tokens_total(),
        "tokens_inflight": _tokens_inflight(),
        **usage,
        "usage_events_active": usage_events_exist(),
        "expensive_research_tier": bool(tier_pub.get("expensive_research_tier")),
        "tier_routing": tier_pub,
    }


@app.get("/tokens")
def get_tokens():
    payload = _tokens_payload()
    return JSONResponse(
        payload,
        headers={"Cache-Control": "no-store, max-age=0", "X-Korymb-Version": str(BACKEND_VERSION)},
    )


def _runtime_sync_snapshot() -> dict:
    """Petit snapshot unifié pour synchronisation live front (SSE)."""
    cfg = merge_with_env()
    provider = str(cfg.get("llm_provider") or "anthropic").strip().lower()
    if provider == "openrouter":
        model, _, _, _ = resolve_openrouter_tier(cfg, "lite")
    else:
        provider = "anthropic"
        model = cfg.get("anthropic_model")
    return {
        "ts": datetime.now(ZoneInfo("Europe/Paris")).isoformat(),
        "backend_version": BACKEND_VERSION,
        "llm": {
            "provider": provider,
            "model": model,
        },
        "tokens": _tokens_payload(),
        "health": {
            "status": "ok",
        },
    }


@app.get("/events/stream", dependencies=[Depends(verify_secret)])
async def events_stream(request: Request):
    async def gen():
        last_payload = ""
        event_id = 0
        while True:
            if await request.is_disconnected():
                break
            try:
                snapshot = _runtime_sync_snapshot()
                payload = json.dumps(snapshot, ensure_ascii=False)
                if payload != last_payload:
                    event_id += 1
                    yield f"id: {event_id}\nevent: runtime_sync\ndata: {payload}\n\n"
                    last_payload = payload
                else:
                    # heartbeat SSE pour garder la connexion active côté proxies
                    yield "event: ping\ndata: {}\n\n"
            except Exception as e:
                err = json.dumps({"error": str(e), "ts": datetime.now(ZoneInfo("Europe/Paris")).isoformat()})
                yield f"event: runtime_error\ndata: {err}\n\n"
            await asyncio.sleep(2.0)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Korymb-Version": str(BACKEND_VERSION),
        },
    )


@app.post("/run", response_model=MissionResponse, dependencies=[Depends(verify_secret)])
async def run_mission(request: MissionRequest, background_tasks: BackgroundTasks):
    rsid = (request.remove_mission_session_id or "").strip()
    if rsid:
        if not delete_mission_session(rsid):
            raise HTTPException(status_code=404, detail="Session introuvable.")
        return MissionResponse(status="session_deleted", job_id=rsid, agent="coordinateur")

    vj = (request.user_validate_job_id or "").strip()
    if vj:
        out = _validate_mission_by_user_impl(vj)
        row = db_get_job(vj)
        agent_key = (row or {}).get("agent") or "coordinateur"
        if agent_key not in agents_def():
            agent_key = "coordinateur"
        uva = out.get("user_validated_at")
        st = "already_validated" if out.get("already") else "validated"
        return MissionResponse(status=st, job_id=vj, agent=agent_key, user_validated_at=uva)

    mission_plain = (request.mission or "").strip()
    if not mission_plain:
        raise HTTPException(status_code=400, detail="Mission vide.")

    job_id = str(uuid.uuid4())[:8]
    agent_key = request.agent if request.agent in agents_def() else "coordinateur"
    mcfg = request.mission_config.model_dump() if request.mission_config else _mission_config_from_payload(None)
    _schedule_mission_execution(
        background_tasks,
        job_id,
        agent_key,
        mission_plain,
        request.context,
        "mission",
        mission_config=mcfg,
    )
    return MissionResponse(status="accepted", job_id=job_id, agent=agent_key)


@app.post("/mission-sessions", dependencies=[Depends(verify_secret)])
def mission_sessions_create(body: MissionSessionCreate):
    agent_key = body.agent if body.agent in agents_def() else "coordinateur"
    sid = str(uuid.uuid4()).replace("-", "")[:12]
    create_mission_session(sid, agent_key, (body.title or "").strip())
    if body.initial_message and str(body.initial_message).strip():
        append_session_message(sid, "user", str(body.initial_message).strip())
        s = get_mission_session(sid)
        if s:
            reply, ti, to = _session_planning_llm_turn(s)
            _add_daily(ti, to)
            append_session_message(sid, "assistant", reply)
    row = get_mission_session(sid)
    if not row:
        raise HTTPException(status_code=500, detail="Session non créée.")
    return row


@app.get("/mission-sessions", dependencies=[Depends(verify_secret)])
def mission_sessions_list(limit: int = 40):
    return {"sessions": list_mission_sessions(limit)}


@app.get("/mission-sessions/{session_id}", dependencies=[Depends(verify_secret)])
def mission_sessions_get(session_id: str):
    row = get_mission_session(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return row


@app.delete("/mission-sessions/{session_id}", dependencies=[Depends(verify_secret)])
def mission_sessions_delete(session_id: str):
    if not delete_mission_session(session_id):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return {"deleted": True, "session_id": session_id}


@app.post("/mission-sessions/{session_id}/remove", dependencies=[Depends(verify_secret)])
def mission_sessions_remove(session_id: str):
    """Même effet que DELETE (fallback si un proxy bloque DELETE)."""
    if not delete_mission_session(session_id):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return {"deleted": True, "session_id": session_id}


@app.post("/mission-sessions/{session_id}/message", dependencies=[Depends(verify_secret)])
def mission_sessions_message(session_id: str, body: MissionSessionMessageBody):
    s = get_mission_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    if s["status"] != "draft":
        raise HTTPException(status_code=400, detail="Session figée : crée une nouvelle session pour continuer.")
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message vide.")
    append_session_message(session_id, "user", msg)
    s2 = get_mission_session(session_id)
    if not s2:
        raise HTTPException(status_code=500, detail="Session perdue.")
    reply, ti, to = _session_planning_llm_turn(s2)
    _add_daily(ti, to)
    append_session_message(session_id, "assistant", reply)
    return get_mission_session(session_id)


@app.post("/mission-sessions/{session_id}/validate", dependencies=[Depends(verify_secret)])
def mission_sessions_validate(
    session_id: str,
    body: MissionSessionValidateBody,
    background_tasks: BackgroundTasks,
):
    s = get_mission_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    if s["status"] != "draft":
        raise HTTPException(status_code=400, detail="Déjà validée ou clôturée.")
    agent_key = s["agent"] if s["agent"] in agents_def() else "coordinateur"
    try:
        brief = _compose_mission_brief_from_session(s, body.brief)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    # Toujours annexer le cadrage pour le CIO : une consigne surchargée (« Ok je lance le test ») ne doit pas
    # effacer les formulations du dirigeant (« au commercial », etc.) sans quoi le plan reste « CIO seul ».
    if agent_key == "coordinateur":
        brief = _append_session_exchange_for_delegation(s, brief)
    elif not (body.brief and str(body.brief).strip()):
        brief = _append_session_exchange_for_delegation(s, brief)
    job_id = str(uuid.uuid4())[:8]
    mcfg = _mission_config_from_payload(body.mission_config)
    _schedule_mission_execution(
        background_tasks, job_id, agent_key, brief, None, "mission_session", mission_config=mcfg,
    )
    note = f"[Système] Mission validée — exécution lancée (job #{job_id}). Tu peux suivre le flux d’interactions dans le QG."
    mission_session_commit(session_id, job_id, brief, closing_message=note)
    return {"job_id": job_id, "session_id": session_id, "agent": agent_key, "brief": brief}


def _mission_followup_context_from_parent(parent_job_id: str) -> str:
    """Texte injecté dans le tour CIO « chat » pour reprendre une mission déjà exécutée (validée ou non)."""
    row = db_get_job(parent_job_id)
    if not row:
        return ""
    parts: list[str] = []
    parts.append(f"--- Suite sur la même mission (dossier #{parent_job_id}) ---")
    mission = (row.get("mission") or "").strip()
    if mission:
        parts.append(f"Consigne / titre de la mission d'origine :\n{mission[:4000]}")
    res = (row.get("result") or "").strip()
    if res:
        parts.append(f"Livrable ou synthèse CIO en date de cette mission (référence) :\n{res[:16000]}")
    mt = row.get("mission_thread") if isinstance(row.get("mission_thread"), list) else []
    if mt:
        lines: list[str] = []
        for e in mt[-28:]:
            if not isinstance(e, dict):
                continue
            r = str(e.get("role") or "")
            ag = str(e.get("agent") or "").strip()
            c = str(e.get("content") or "").strip()
            if not c:
                continue
            tag = "Dirigeant" if r == "user" else (ag or "assistant")
            lines.append(f"[{tag}] {c[:2800]}")
        if lines:
            parts.append("Échanges déjà enregistrés sur cette mission (fil) :\n" + "\n\n".join(lines))
    parts.append(
        "Tu traites une **demande de suite** : nouveaux objectifs, affinage du livrable, tâches additionnelles, "
        "corrections ou itération sans repartir de zéro. Réutilise le contexte ci-dessus ; délègue aux sous-agents "
        "si c'est pertinent pour cette suite."
    )
    return "\n\n".join(parts) + "\n\n"


@app.post("/chat", dependencies=[Depends(verify_secret)])
async def chat(request: ChatRequest, background_tasks: BackgroundTasks):
    agent_cfg = agents_def().get(request.agent, agents_def()["coordinateur"])

    try:
        # CIO : orchestration en arrière-plan (comme /run) pour que le front puisse poller /jobs/{id} en direct.
        if request.agent == "coordinateur":
            job_id = str(uuid.uuid4())[:8]
            now_iso = datetime.utcnow().isoformat()
            linked_parent_id = (request.linked_job_id or "").strip()[:16]
            # Reprise sur une mission existante : le contexte vient du job parent en base (mission_thread, etc.).
            # Ne pas rejouer `request.history` (évite doublons et « seconde mission » côté modèle).
            hist_snap = [] if linked_parent_id else list(request.history[-6:])
            msg_snap = request.message
            save_job(
                job_id,
                "coordinateur",
                (request.message or "")[:500],
                source="chat",
                parent_job_id=linked_parent_id or None,
            )
            job_logs: list[str] = []
            active_jobs[job_id] = {
                "status": "running",
                "agent": "coordinateur",
                "mission": (request.message or "")[:500],
                "result": None,
                "logs": job_logs,
                "tokens_in": 0,
                "tokens_out": 0,
                "team": [],
                "events": [],
                "plan": {},
                "source": "chat",
                "created_at": now_iso,
                "parent_job_id": linked_parent_id or None,
            }
            job_logs_ref = active_jobs[job_id]["logs"]

            def execute_chat_cio():
                try:
                    _emit_job_event(
                        job_id,
                        "mission_start",
                        "coordinateur",
                        {"label": agent_cfg["label"], "mode": "chat", "preview": (msg_snap or "")[:240]},
                    )
                    hist_lines: list[str] = []
                    for h in hist_snap:
                        if h.get("role") in ("user", "assistant"):
                            role = "Utilisateur" if h["role"] == "user" else "CIO"
                            c = h.get("content", "")
                            if isinstance(c, str):
                                hist_lines.append(f"{role}: {c[:800]}")
                    conv = "\n".join(hist_lines) if hist_lines else "(début de conversation)"
                    parent_blob = (
                        _mission_followup_context_from_parent(linked_parent_id)
                        if linked_parent_id
                        else ""
                    )
                    if parent_blob:
                        mission_txt = (
                            parent_blob
                            + (
                                "Échanges récents dans cette session (chat) :\n"
                                + conv
                                + "\n\nDernière demande à traiter maintenant :\n"
                                + msg_snap
                                if hist_snap
                                else "Nouvelle demande du dirigeant (à traiter maintenant) :\n" + msg_snap
                            )
                        )
                    else:
                        mission_txt = (
                            f"Échanges récents :\n{conv}\n\n"
                            f"Dernière demande à traiter maintenant :\n{msg_snap}"
                        )
                    text, ti, to = orchestrate_coordinateur_mission(
                        mission_txt, msg_snap, job_logs_ref, chat_mode=True, job_id=job_id,
                    )
                    _add_daily(ti, to)
                    team_snap = active_jobs[job_id].get("team", [])
                    pl = active_jobs[job_id].get("plan") or {}
                    ev = active_jobs[job_id].get("events") or []
                    # Aligner la mémoire avant SQLite : le front polle GET /jobs/{id} qui lit active_jobs en priorité.
                    if job_id in active_jobs:
                        active_jobs[job_id].update({
                            "status": "completed",
                            "result": text,
                            "tokens_in": ti,
                            "tokens_out": to,
                        })
                    update_job(
                        job_id,
                        "completed",
                        text,
                        job_logs_ref,
                        ti,
                        to,
                        team_trace=team_snap,
                        plan=pl,
                        events=ev,
                        source="chat",
                    )
                    try:
                        append_recent_mission(job_id, msg_snap, text or "")
                    except Exception:
                        logger.exception("append_recent_mission (chat)")
                    if linked_parent_id and linked_parent_id != job_id:
                        try:
                            append_job_mission_thread(
                                linked_parent_id,
                                role="user",
                                agent="dirigeant",
                                content=(msg_snap or "")[:8000],
                                source="chat_suivi_mission",
                            )
                            append_job_mission_thread(
                                linked_parent_id,
                                role="assistant",
                                agent="coordinateur",
                                content=(text or "")[:14000],
                                source="chat_suivi_mission",
                            )
                        except Exception:
                            logger.exception("append_job_mission_thread (chat → mission liée)")
                except Exception as e:
                    user_result = _user_visible_job_failure_markdown(e)
                    team_snap = active_jobs.get(job_id, {}).get("team", [])
                    pl = active_jobs.get(job_id, {}).get("plan") or {}
                    ev = active_jobs.get(job_id, {}).get("events") or []
                    _emit_job_event(job_id, "error", None, {"message": str(e)[:500]})
                    job_logs_ref.append(f"[korymb] Erreur : {e}")
                    if job_id in active_jobs:
                        active_jobs[job_id].update({"status": f"error: {e}", "result": user_result})
                    update_job(
                        job_id,
                        f"error: {e}",
                        user_result,
                        job_logs_ref,
                        0,
                        0,
                        team_trace=team_snap,
                        plan=pl,
                        events=ev,
                        source="chat",
                    )
                finally:
                    active_jobs.pop(job_id, None)

            background_tasks.add_task(execute_chat_cio)
            return {"status": "accepted", "job_id": job_id, "agent": "coordinateur"}

        system_prompt = (
            agent_cfg["system"]
            + FLEUR_CONTEXT
            + SUB_AGENT_COORDINATION_FR
            + "\nRéponds de façon concise et directe."
        )
        messages = []
        for h in request.history[-10:]:
            if h.get("role") in ("user", "assistant"):
                messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": request.message})

        link_th = (request.linked_job_id or "").strip()[:16]
        usage_kw: dict = {"usage_context": f"chat_sync:{request.agent}"}
        if link_th:
            usage_kw["usage_job_id"] = link_th
        reply, ti, to = llm_chat_maybe_tools(
            system_prompt,
            messages,
            agent_cfg.get("tools"),
            job_logs=None,
            max_tokens=2048,
            **usage_kw,
        )
        _add_daily(ti, to)
        if link_th:
            try:
                append_job_mission_thread(
                    link_th,
                    role="user",
                    agent="dirigeant",
                    content=(request.message or "")[:8000],
                    source=f"chat_{request.agent}",
                )
                append_job_mission_thread(
                    link_th,
                    role="assistant",
                    agent=request.agent,
                    content=(reply or "")[:14000],
                    source=f"chat_{request.agent}",
                )
            except Exception:
                logger.exception("append_job_mission_thread (chat synchrone)")
        return {"response": reply, "agent": request.agent}
    except Exception as e:
        raise HTTPException(status_code=500, detail=_user_visible_chat_sync_failure_text(e)) from e


def _delete_job_impl(job_id: str) -> dict:
    active_jobs.pop(job_id, None)
    from database import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        conn.commit()
    return {"deleted": job_id}


def _clear_jobs_impl() -> dict:
    active_jobs.clear()
    from database import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM jobs")
        conn.commit()
    return {"cleared": True}


@app.get("/jobs", dependencies=[Depends(verify_secret)])
def list_jobs(limit: int = 50):
    db_jobs = {j["id"]: j for j in db_list_jobs(limit)}
    for jid, job in active_jobs.items():
        prev = db_jobs.get(jid)
        merged = {"id": jid, **job, "logs": []}
        if prev:
            if prev.get("user_validated_at"):
                merged["user_validated_at"] = prev["user_validated_at"]
            if prev.get("mission_config"):
                merged["mission_config"] = prev["mission_config"]
            if prev.get("mission_thread"):
                merged["mission_thread"] = prev["mission_thread"]
            if prev.get("parent_job_id"):
                merged["parent_job_id"] = prev["parent_job_id"]
        db_jobs[jid] = merged
    jobs = sorted(db_jobs.values(), key=lambda j: j.get("created_at", ""), reverse=True)
    out: list[dict] = []
    for j in jobs:
        if len(out) >= limit:
            break
        # Jobs « tour technique » CIO liés à une mission (POST /chat + linked_job_id) : pas d’entrée métier à part.
        if (j.get("parent_job_id") or "").strip() and str(j.get("source") or "") == "chat":
            continue
        ev = j.get("events") or []
        if not isinstance(ev, list):
            ev = []
        pl = j.get("plan") if isinstance(j.get("plan"), dict) else {}
        has_plan = bool(
            (str(pl.get("synthese_attendue") or "").strip())
            or (pl.get("sous_taches") or {})
            or (pl.get("agents") or []),
        )
        uva = j.get("user_validated_at") or None
        mc = j.get("mission_config") if isinstance(j.get("mission_config"), dict) else {}
        mt = j.get("mission_thread") if isinstance(j.get("mission_thread"), list) else []
        dw = _extract_delivery_warnings_from_events(ev)
        out.append({
            "job_id": j.get("id", j.get("job_id", "")),
            "agent": j["agent"],
            "mission": j["mission"],
            "status": j["status"],
            "tokens_in": j.get("tokens_in", 0),
            "tokens_out": j.get("tokens_out", 0),
            "created_at": j.get("created_at", ""),
            "team": _parse_team_field(j),
            "source": j.get("source", "mission"),
            "events_count": len(ev),
            "has_plan": has_plan,
            "user_validated_at": uva,
            "mission_closed_by_user": bool(uva),
            "mission_config": mc,
            "mission_thread": mt[-12:] if len(mt) > 12 else mt,
            "mission_thread_count": len(mt),
            "delivery_warnings": dw,
            "delivery_blocked": bool(dw),
            "parent_job_id": j.get("parent_job_id") or None,
        })
    return {"jobs": out}


# POST en complément de DELETE : certains reverse proxies / hébergeurs renvoient 405 sur DELETE.
@app.post("/jobs/clear", dependencies=[Depends(verify_secret)])
def clear_jobs_post():
    return _clear_jobs_impl()


@app.delete("/jobs", dependencies=[Depends(verify_secret)])
def clear_jobs():
    return _clear_jobs_impl()


def _validate_mission_by_user_impl(job_id: str) -> dict:
    """Clôture explicite par le dirigeant : la mission reste consultable mais est marquée validée."""
    if active_jobs.get(job_id, {}).get("status") == "running":
        raise HTTPException(status_code=400, detail="Mission encore en cours.")
    row = db_get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    if row.get("user_validated_at"):
        return {"job_id": job_id, "already": True, "user_validated_at": row["user_validated_at"]}
    if row.get("status") != "completed":
        raise HTTPException(
            status_code=400,
            detail="Seule une mission terminée avec succès peut être validée par le dirigeant.",
        )
    if not job_set_user_validated(job_id):
        row2 = db_get_job(job_id)
        if row2 and row2.get("user_validated_at"):
            return {"job_id": job_id, "user_validated_at": row2["user_validated_at"]}
        raise HTTPException(status_code=500, detail="Enregistrement de la validation impossible.")
    row3 = db_get_job(job_id)
    return {"job_id": job_id, "user_validated_at": row3.get("user_validated_at") if row3 else None}


@app.post("/jobs/validate-mission", dependencies=[Depends(verify_secret)])
def validate_mission_by_user_body(payload: ValidateMissionPayload):
    """Même logique que /jobs/{id}/validate-mission (corps JSON ; évite /jobs/{job_id} avec id=validate-mission)."""
    jid = str(payload.job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    return _validate_mission_by_user_impl(jid)


@app.get("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def get_job(job_id: str, log_offset: int = 0, events_offset: int = 0):
    cfg = merge_with_env()
    pin = float(cfg.get("llm_price_input_per_million_usd") or 0)
    pout = float(cfg.get("llm_price_output_per_million_usd") or 0)
    job = active_jobs.get(job_id)
    if job:
        logs = job.get("logs", [])
        total = job.get("tokens_in", 0) + job.get("tokens_out", 0)
        ev = job.get("events") or []
        if not isinstance(ev, list):
            ev = []
        off = max(0, events_offset)
        row_db = db_get_job(job_id)
        uva = (row_db or {}).get("user_validated_at") if row_db else None
        mc = job.get("mission_config")
        if (not isinstance(mc, dict) or not mc) and row_db:
            mc = row_db.get("mission_config") if isinstance(row_db.get("mission_config"), dict) else {}
        mt: list = []
        if row_db and isinstance(row_db.get("mission_thread"), list):
            mt = row_db["mission_thread"]
        dw = _extract_delivery_warnings_from_events(ev)
        parent_out = job.get("parent_job_id") or ((row_db or {}).get("parent_job_id") if row_db else None)
        return {
            "job_id": job_id,
            "status": job["status"],
            "agent": job["agent"],
            "mission": job["mission"],
            "result": job.get("result"),
            "team": job.get("team") or [],
            "logs": logs[log_offset:],
            "log_total": len(logs),
            "tokens_in": job.get("tokens_in", 0),
            "tokens_out": job.get("tokens_out", 0),
            "tokens_total": total,
            "cost_usd": round(
                (job.get("tokens_in", 0) * pin + job.get("tokens_out", 0) * pout) / 1_000_000,
                5,
            ),
            "token_alert": total >= settings.token_alert_threshold,
            "source": job.get("source", "mission"),
            "plan": job.get("plan") or {},
            "events": ev[off:],
            "events_total": len(ev),
            "events_offset": off,
            "user_validated_at": uva,
            "mission_closed_by_user": bool(uva),
            "mission_config": mc if isinstance(mc, dict) else {},
            "mission_thread": mt,
            "mission_thread_count": len(mt),
            "delivery_warnings": dw,
            "delivery_blocked": bool(dw),
            "parent_job_id": parent_out or None,
        }
    row = db_get_job(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    logs = row.get("logs", [])
    total = row.get("tokens_in", 0) + row.get("tokens_out", 0)
    ev = row.get("events") or []
    if not isinstance(ev, list):
        ev = []
    off = max(0, events_offset)
    uva = row.get("user_validated_at")
    mc = row.get("mission_config") if isinstance(row.get("mission_config"), dict) else {}
    mt = row.get("mission_thread") if isinstance(row.get("mission_thread"), list) else []
    dw = _extract_delivery_warnings_from_events(ev)
    return {
        "job_id": job_id,
        "status": row["status"],
        "agent": row["agent"],
        "mission": row["mission"],
        "result": row.get("result"),
        "team": _parse_team_field(row),
        "logs": logs[log_offset:],
        "log_total": len(logs),
        "tokens_in": row.get("tokens_in", 0),
        "tokens_out": row.get("tokens_out", 0),
        "tokens_total": total,
        "cost_usd": round(
            (row.get("tokens_in", 0) * pin + row.get("tokens_out", 0) * pout) / 1_000_000,
            5,
        ),
        "created_at": row.get("created_at"),
        "token_alert": total >= settings.token_alert_threshold,
        "source": row.get("source", "mission"),
        "plan": row.get("plan") or {},
        "events": ev[off:],
        "events_total": len(ev),
        "events_offset": off,
        "user_validated_at": uva,
        "mission_closed_by_user": bool(uva),
        "mission_config": mc,
        "mission_thread": mt,
        "mission_thread_count": len(mt),
        "delivery_warnings": dw,
        "delivery_blocked": bool(dw),
        "parent_job_id": row.get("parent_job_id") or None,
    }


@app.post("/jobs/{job_id}/validate-mission", dependencies=[Depends(verify_secret)])
def validate_mission_by_user(job_id: str):
    return _validate_mission_by_user_impl(job_id)


@app.post("/jobs/{job_id}/cancel", dependencies=[Depends(verify_secret)])
def cancel_running_job(job_id: str):
    """Demande d'arrêt coopératif : le worker vérifie le drapeau entre les étapes LLM."""
    jid = (job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    row = active_jobs.get(jid)
    if not row:
        raise HTTPException(
            status_code=404,
            detail="Mission introuvable en mémoire (déjà terminée ou redémarrage serveur).",
        )
    if row.get("status") != "running":
        raise HTTPException(status_code=400, detail="La mission n'est pas en cours d'exécution.")
    row["cancel_requested"] = True
    return {"ok": True, "job_id": jid, "message": "Annulation enregistrée ; l'exécution s'arrête dès la prochaine étape."}


@app.post("/jobs/{job_id}/remove", dependencies=[Depends(verify_secret)])
def delete_job_post(job_id: str):
    return _delete_job_impl(job_id)


@app.delete("/jobs/{job_id}", dependencies=[Depends(verify_secret)])
def delete_job(job_id: str):
    return _delete_job_impl(job_id)


# Même logique que /jobs/* mais sous /run : les proxys qui autorisent POST /run bloquent souvent DELETE sur /jobs.
@app.post("/run/remove-job", dependencies=[Depends(verify_secret)])
def run_remove_job(payload: RemoveJobPayload):
    return _delete_job_impl(payload.job_id)


@app.post("/run/remove-mission-session", dependencies=[Depends(verify_secret)])
def run_remove_mission_session(payload: RemoveMissionSessionPayload):
    """Même effet que DELETE /mission-sessions/{id} ; chemin court pour proxys restrictifs."""
    sid = str(payload.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id manquant.")
    if not delete_mission_session(sid):
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return {"deleted": True, "session_id": sid}


@app.post("/run/validate-mission", dependencies=[Depends(verify_secret)])
def run_validate_mission(payload: ValidateMissionPayload):
    """Même logique que POST /jobs/{id}/validate-mission (proxys qui n’aiment pas les chemins longs)."""
    jid = str(payload.job_id or "").strip()
    if not jid:
        raise HTTPException(status_code=400, detail="job_id manquant.")
    return _validate_mission_by_user_impl(jid)


@app.post("/run/clear-jobs", dependencies=[Depends(verify_secret)])
def run_clear_jobs():
    return _clear_jobs_impl()
