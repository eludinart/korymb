"""
services/mission.py — Logique orchestration missions : helpers plan/délégation,
orchestrate_coordinateur_mission, _schedule_mission_execution.
Extrait de main.py, sans dépendance circulaire vers main ou routers.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import BackgroundTasks, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from config import settings
from database import (
    get_job as db_get_job,
    save_job,
    update_job,
    append_recent_mission,
    append_job_mission_thread,
    list_jobs_prompt_digest,
    job_set_user_validated,
    get_enterprise_memory,
    get_orchestration_prompt,
    get_behavior_setting,
)
from llm_client import llm_turn, llm_chat
from agent_tool_use import llm_chat_maybe_tools, llm_turn_maybe_tools
from state import (
    active_jobs,
    KorymbJobCancelled,
    raise_if_job_cancelled as _raise_if_job_cancelled,
    add_daily as _add_daily,
    sync_active_job_tokens as _sync_active_job_tokens,
    emit_job_event as _emit_job_event,
    publish_team as _publish_team,
    _cio_ndjson_trace,
)
from services.agents import (
    agents_def,
    FLEUR_CONTEXT,
    delegatable_subagent_keys_ordered,
    SUB_AGENT_COORDINATION_FR,
    MODE_CADRAGE_CIO,
    MODE_CADRAGE_AGENT,
    _ascii_fold,
)
from services.memory import active_memory_prompt
from services.orchestration_prompt_defaults import DEFAULT_ORCHESTRATION_PROMPTS
from services.behavior_defaults import behavior_default_value
from debug_ndjson import append_session_ndjson

logger = logging.getLogger(__name__)


def _behavior_value(key: str):
    v = get_behavior_setting(key)
    return behavior_default_value(key) if v is None else v


def _behavior_int(key: str, fallback: int) -> int:
    v = _behavior_value(key)
    try:
        return int(v)
    except (TypeError, ValueError):
        return fallback


def _behavior_float(key: str, fallback: float) -> float:
    v = _behavior_value(key)
    try:
        return float(v)
    except (TypeError, ValueError):
        return fallback


def _behavior_text(key: str, fallback: str) -> str:
    v = _behavior_value(key)
    if isinstance(v, str) and v.strip():
        return v
    return fallback


def _behavior_dict_str(key: str, fallback: dict[str, str]) -> dict[str, str]:
    v = _behavior_value(key)
    if not isinstance(v, dict):
        return fallback
    out: dict[str, str] = {}
    for k, val in v.items():
        ks = str(k).strip()
        vs = str(val).strip()
        if ks and vs:
            out[ks] = vs
    return out or fallback


def _behavior_str_list(key: str, fallback: list[str]) -> list[str]:
    v = _behavior_value(key)
    if not isinstance(v, list):
        return fallback
    out = [str(x).strip() for x in v if str(x).strip()]
    return out or fallback


def _render_orchestration_prompt(prompt_key: str, mapping: dict[str, str]) -> str:
    raw = (get_orchestration_prompt(prompt_key) or "").strip()
    if not raw:
        raw = (DEFAULT_ORCHESTRATION_PROMPTS.get(prompt_key) or "").strip()
    out = raw
    for k, v in mapping.items():
        out = out.replace(f"<<{k}>>", v)
    return out


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
    aliases = _behavior_dict_str("orchestration.routing.delegation_key_aliases", _DELEGATION_KEY_ALIASES)
    canon = aliases.get(nk) or (nk if nk in agents_def() else None)
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

    raw_agents = plan.get("agents")
    # Si le CIO a explicitement decide agents:[] (solo), ne pas surcharger avec heuristiques
    cio_said_solo = isinstance(raw_agents, list) and len(raw_agents) == 0

    keys: list[str] = list(_mentioned_sub_agents(blob))
    if not keys and not cio_said_solo:
        keys = _infer_agents_from_mission_keywords(blob)
    if not keys and _signals_explicit_multi_agent_communication(blob):
        keys = list(delegatable_subagent_keys_ordered())
    if not keys:
        if cio_said_solo:
            log("[korymb] Plan CIO seul - aucune materialisation automatique d'agents.")
            return
        if (
            _plan_agents_json_non_executable(raw_agents)
            or raw_agents is None
            or len(blob) > 80
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
    aliases = _behavior_dict_str("orchestration.routing.delegation_key_aliases", _DELEGATION_KEY_ALIASES)
    out: dict[str, str] = {}
    skipped: list[str] = []
    for k, v in (raw or {}).items():
        if not isinstance(k, str):
            continue
        nk = re.sub(r"\s+", "_", _ascii_fold(k)).replace("-", "_")
        canon = aliases.get(nk) or (nk if nk in agents_def() else None)
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
    keys = _behavior_str_list("orchestration.routing.sous_taches_plan_keys", list(_SOUS_TACHES_PLAN_KEYS))
    for pk in keys:
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
    web_tool_names = frozenset(
        _behavior_str_list("orchestration.tools.web_research_tool_names", list(_WEB_RESEARCH_TOOL_NAMES))
    )
    dev_web_tool_names = frozenset(
        _behavior_str_list("orchestration.tools.dev_web_research_tool_names", list(_DEV_WEB_RESEARCH_TOOL_NAMES))
    )
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
            if _count_agent_tool_calls(events, ag, web_tool_names) == 0:
                warnings.append(
                    f"{label} : la mission demandait des pistes / recherche web ou LinkedIn public, "
                    f"mais aucun appel enregistré à web_search, read_webpage ou search_linkedin — "
                    f"le livrable peut être non sourcé."
                )
        elif ag == "developpeur" and _agent_tool_tags_include_webish(ag) and _blob_needs_developer_web_evidence(per):
            if _count_agent_tool_calls(events, ag, dev_web_tool_names) == 0:
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
    if len(mentioned) >= 1:
        targets = mentioned
    elif re.search(r"differents.{0,14}agents|plusieurs agents|tous les agents|chaque agent", blob):
        targets = list(delegatable_subagent_keys_ordered())
    else:
        # Signal vague (ex. test de communication) sans agent nomme :
        # ne pas deployer toute l'equipe - laisser le CIO gerer seul.
        return None
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


def _wait_for_cio_plan_hitl_resolution(job_id: str, job_logs: list | None) -> dict:
    """
    Bloque jusqu'à résolution HITL (approve / reject / amend) pour le plan CIO.
    Retourne {"decision": "approve"} ou {"decision": "amend", "amended_plan": {...}}.
    Lève KorymbJobCancelled si le job est annulé ou rejeté.
    """
    max_wait = _behavior_int("orchestration.cio.hitl_wait_max_seconds", 7200)
    poll_interval = _behavior_float("orchestration.cio.hitl_poll_interval_seconds", 0.28)
    if poll_interval <= 0:
        poll_interval = 0.28
    for i in range(max_wait):
        _raise_if_job_cancelled(job_id)
        row = db_get_job(job_id)
        if not row:
            time.sleep(poll_interval)
            continue
        st = str(row.get("status") or "")
        if st == "awaiting_validation":
            time.sleep(poll_interval)
            continue
        if st == "cancelled":
            if job_logs is not None:
                job_logs.append("[korymb] Plan CIO — rejet ou annulation dirigeant (HITL).")
            raise KorymbJobCancelled()
        if st == "running":
            res = row.get("hitl_resolution")
            if isinstance(res, dict) and res.get("decision") == "amend" and isinstance(res.get("amended_plan"), dict):
                return res
            return {"decision": "approve"}
        time.sleep(poll_interval)
        if i > 0 and i % 200 == 0 and job_logs is not None:
            job_logs.append("[korymb] Toujours en attente de validation du plan CIO (HITL)…")
    raise RuntimeError("Délai dépassé en attente de validation du plan CIO (HITL).")


def _apply_cio_plan_amendment(
    st: dict,
    plan: dict,
    amended: dict,
    log,
    job_id: str | None,
) -> None:
    """Fusionne la version dirigeant dans le plan exécutable (sous_tâches + synthèse)."""
    subs = amended.get("sous_taches") if isinstance(amended.get("sous_taches"), dict) else {}
    syn = amended.get("synthese_attendue")
    if isinstance(syn, str) and syn.strip():
        plan["synthese_attendue"] = syn.strip()
    if subs:
        for k, v in subs.items():
            if k not in agents_def() or k == "coordinateur":
                continue
            vs = _tache_to_str(v).strip()
            if vs:
                st[k] = vs
    agents_ov = amended.get("agents")
    if isinstance(agents_ov, list) and agents_ov:
        allowed = {str(k).strip() for k in agents_ov if str(k).strip() in agents_def() and str(k).strip() != "coordinateur"}
        for k in list(st.keys()):
            if k in agents_def() and k != "coordinateur" and k not in allowed:
                del st[k]
        for k in allowed:
            if k not in st or not _tache_to_str(st.get(k)).strip():
                raw = subs.get(k) if isinstance(subs, dict) else None
                st[k] = _tache_to_str(raw).strip() or st.get(k, "")
    plan["sous_taches"] = st
    if log:
        log("[korymb] Plan CIO — version dirigeant appliquée (amendement HITL).")
    if job_id:
        _emit_job_event(
            job_id,
            "cio_plan_hitl_resolved",
            "coordinateur",
            {"decision": "amend", "agents": list(st.keys())},
        )


def _team_livrables_markdown_annex(resultats: dict[str, str]) -> str:
    """Annexe lisible dans le corps du résultat mission : textes intégraux des rôles."""
    clip_chars = _behavior_int("orchestration.synthesis.team_livrable_truncate_chars", 14000)
    if clip_chars < 1000:
        clip_chars = 1000
    if not resultats:
        return ""
    parts: list[str] = []
    for k, txt in resultats.items():
        if k not in agents_def() or k == "coordinateur":
            continue
        body = (txt or "").strip()
        if len(body) > clip_chars:
            body = body[:clip_chars] + "\n\n*(suite tronquée pour affichage)*"
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
    cio_questions_enabled: bool = True,
    cio_plan_hitl_enabled: bool = False,
) -> tuple[str, int, int]:
    """
    Plan JSON → exécution par sous-agents → synthèse CIO.
    mission_txt : texte analysé par le CIO (peut inclure historique de chat).
    root_mission_label : rappel court pour les sous-agents (souvent la demande brute utilisateur).
    job_id : si fourni (mission /run), met à jour active_jobs[job_id]["team"] pour l'interface.
    """
    agent_cfg = agents_def()["coordinateur"]
    memory_brain = _korymb_memory_prompt_for("coordinateur", exclude_job_id=job_id) + active_memory_prompt(
        "coordinateur",
        exclude_job_id=job_id,
    )
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

    cq_schema_field = (
        ',\n  "clarifying_questions": []'
        if cio_questions_enabled else ""
    )
    cq_rule = (
        "- clarifying_questions : tableau de 1 à 3 questions courtes si la mission est ambigue sur des points clés "
        "(budget, cible, priorité entre options). La mission s'exécute EN PARALLÈLE — ces questions ne bloquent rien. "
        "Laisse vide [] si la mission est suffisamment claire.\n"
        if cio_questions_enabled else ""
    )
    plan_user = _render_orchestration_prompt(
        "cio_plan_json_user",
        {
            "MISSION_TXT": mission_txt,
            "AGENTS_EXAMPLE_JSON": agents_example_json,
            "SOUS_EXAMPLE_JSON": sous_example_json,
            "KEYS_CSV": keys_csv,
            "MAX_SUB": str(max_sub),
            "CQ_SCHEMA_FIELD": cq_schema_field,
            "CQ_RULE": cq_rule,
        },
    )
    log("[korymb] CIO — analyse de la mission...")
    _raise_if_job_cancelled(job_id)
    plan_txt, ti, to = llm_turn(
        system_prompt + "\n\nTu dois répondre UNIQUEMENT avec un JSON structuré.",
        plan_user,
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

    # ── Questions du CIO pour le dirigeant (non-bloquant, si activé) ──────────
    raw_cq = plan.get("clarifying_questions")
    if cio_questions_enabled and isinstance(raw_cq, list) and raw_cq:
        cq_valid = [str(q).strip() for q in raw_cq if str(q).strip()][:4]
        if cq_valid:
            log(f"[korymb] CIO : {len(cq_valid)} question(s) posée(s) au dirigeant (mission continue en parallèle).")
            if job_id:
                _emit_job_event(
                    job_id,
                    "cio_question",
                    "coordinateur",
                    {
                        "questions": cq_valid,
                        "mission_preview": (root_mission_label or mission_txt or "")[:200],
                        "answered": False,
                    },
                )

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
        st["commercial"] = _behavior_text(
            "orchestration.fallback.prospection_commercial_task",
            (
                "Recherche web + LinkedIn public pour la demande du dirigeant ; "
                "liste courte de pistes (structures / contacts publics) et angles d’approche."
            ),
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
            tpl = _behavior_text(
                "orchestration.fallback.chat_named_role_task_template",
                (
                    "Le dirigeant parle au CIO dans le chat ; le CIO te sollicite sur ce tour.\n"
                    "Obligation : réponds en français avec un contenu **actionnable** que le CIO pourra recopier tel quel "
                    "au dirigeant ; pas de message à un collègue imaginaire, pas de mise en scène du type "
                    "« je te confie la mission » ou « récupère l'heure » sans donner l'heure.\n"
                    "Si la question est factuelle (ex. l'heure civile) : réponds factuellement "
                    "(fuseau Europe/Paris par défaut, format 24 h) dans ta réponse.\n\n"
                    "<<CONTEXT>>"
                ),
            )
            st[role] = tpl.replace("<<CONTEXT>>", ctx_chat)
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

        if cio_plan_hitl_enabled and not chat_mode:
            from services.orchestrator import prepare_hitl_gate

            preview = json.dumps(plan_public, ensure_ascii=False, indent=2)
            if len(preview) > 14000:
                preview = preview[:14000] + "\n…"
            prep = prepare_hitl_gate(
                job_id=job_id,
                mission=(root_mission_label or mission_txt or "")[:800],
                result_preview=preview[:12000],
                reviewer="dirigeant",
                gate_extras={"kind": "cio_plan", "plan_public": plan_public},
            )
            if (prep.get("status") or "") != "awaiting_validation":
                log("[korymb] HITL plan CIO : suspension impossible (état du job), poursuite sans attente.")
            else:
                log("[korymb] Plan CIO — attente validation dirigeant (approuver, modifier ou rejeter).")
                _emit_job_event(
                    job_id,
                    "cio_plan_hitl",
                    "coordinateur",
                    {"status": "awaiting_validation", "kind": "cio_plan"},
                )
                try:
                    j = active_jobs.get(job_id) or {}
                    update_job(
                        job_id,
                        "awaiting_validation",
                        j.get("result"),
                        job_logs,
                        int(j.get("tokens_in", 0)),
                        int(j.get("tokens_out", 0)),
                        j.get("team") or [],
                        plan_public,
                        j.get("events") or [],
                        source=j.get("source"),
                        mission_config=j.get("mission_config") if isinstance(j.get("mission_config"), dict) else None,
                    )
                except Exception:
                    logger.exception("persist awaiting_validation snapshot")
                outcome = _wait_for_cio_plan_hitl_resolution(job_id, job_logs)
                dec = outcome.get("decision") if isinstance(outcome, dict) else "approve"
                if dec == "amend":
                    am = outcome.get("amended_plan")
                    if isinstance(am, dict) and am:
                        _apply_cio_plan_amendment(st, plan, am, log, job_id)
                        delegated = [
                            k
                            for k in st
                            if k in agents_def()
                            and k != "coordinateur"
                            and _tache_to_str(st.get(k)).strip()
                        ]
                        plan_public = {
                            "agents": list(delegated),
                            "synthese_attendue": str(plan.get("synthese_attendue") or "")[:800],
                            "sous_taches": {
                                k: (str(v)[:500] + ("…" if len(str(v)) > 500 else ""))
                                for k, v in st.items()
                                if k in agents_def() and k != "coordinateur"
                            },
                        }
                        active_jobs[job_id]["plan"] = plan_public
                        _emit_job_event(
                            job_id,
                            "plan_parsed",
                            "coordinateur",
                            {"plan": plan_public, "source": "cio_plan_hitl_amend"},
                        )
                else:
                    _emit_job_event(
                        job_id,
                        "cio_plan_hitl_resolved",
                        "coordinateur",
                        {"decision": "approve"},
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
        web_tool_names = frozenset(
            _behavior_str_list("orchestration.tools.web_research_tool_names", list(_WEB_RESEARCH_TOOL_NAMES))
        )
        dev_web_tool_names = frozenset(
            _behavior_str_list("orchestration.tools.dev_web_research_tool_names", list(_DEV_WEB_RESEARCH_TOOL_NAMES))
        )

        def on_sub_tool(actor: str, tool_name: str, meta: dict):
            nonlocal web_evidence_calls
            if job_id and actor == agent_key:
                if agent_key == "commercial" and tool_name in web_tool_names:
                    web_evidence_calls += 1
                elif agent_key == "developpeur" and tool_name in dev_web_tool_names:
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
            sub_user_final += _behavior_text(
                "orchestration.subagent.commercial_web_mandate_suffix",
                _COMMERCIAL_WEB_MANDATE_SUFFIX,
            )
        elif need_dev_web:
            sub_user_final += _behavior_text(
                "orchestration.subagent.developer_web_mandate_suffix",
                _DEVELOPER_WEB_MANDATE_SUFFIX,
            )
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
                    _behavior_text(
                        "orchestration.subagent.repair_web_tools_suffix",
                        _REPAIR_WEB_TOOLS_SUFFIX,
                    )
                    if need_commercial_web
                    else _behavior_text(
                        "orchestration.subagent.repair_dev_web_tools_suffix",
                        _REPAIR_DEV_WEB_TOOLS_SUFFIX,
                    )
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
        synthese_user = _render_orchestration_prompt(
            "cio_synthesis_with_team_user",
            {
                "ROOT_MISSION_LABEL": root_mission_label,
                "CONTRIBUTIONS": contributions,
            },
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
        solo_questions_suffix = "" if chat_mode else _render_orchestration_prompt("cio_synthesis_solo_suffix", {})
        result, ti3, to3 = llm_turn(
            system_prompt + chat_tail + synth_grounding,
            mission_txt + solo_questions_suffix,
            max_tokens=2048 if chat_mode else 4096,
            or_profile="standard",
            usage_job_id=job_id,
            usage_context="cio_synthesis",
        )
    t_in += ti3
    t_out += to3
    _sync_active_job_tokens(job_id, t_in, t_out)

    # Supprime les code fences extérieures si le modèle a enveloppé toute la synthèse dans ```...```
    if isinstance(result, str) and result.lstrip().startswith("```"):
        result = re.sub(r"^```[a-zA-Z]*\s*\n?", "", result.lstrip(), count=1)
        result = re.sub(r"\n?```\s*$", "", result.rstrip())
        result = result.strip()

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

class MissionRunConfig(BaseModel):
    """Options de lancement (QG / mission guidée) — persistantes sur le job."""

    model_config = ConfigDict(extra="ignore")
    recursive_refinement_enabled: bool = False
    recursive_max_rounds: int = Field(default=0, ge=0, le=12)
    require_user_validation: bool = True
    # Mode d'orchestration : "cio" (défaut), "triad" (Architect/Executor/Critic), "single"
    mode: str = Field(default="cio", pattern="^(cio|triad|single)$")
    # Autoriser le CIO à poser des questions au dirigeant en cours de mission
    cio_questions_enabled: bool = True
    # Pause HITL après le plan CIO (validation / amendement dirigeant avant délégation)
    cio_plan_hitl_enabled: bool = True

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

KORYMB_MAX_REFINEMENT_ROUNDS = 12

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
        cio_plan_hitl_enabled=False,
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
            mission_mode = str(cfg.get("mode") or "cio")
            if mission_mode == "triad":
                from services.triad_orchestrator import orchestrate_triad
                from services.knowledge import build_entity_context_block
                _emit_job_event(
                    job_id, "delegation", "architect",
                    {"label": "Architecte", "detail": "Analyse + planification (mode Triade)"},
                )
                entity_ctx = build_entity_context_block(mission_plain)
                result, t_in_total, t_out_total = orchestrate_triad(
                    mission_txt,
                    mission_plain,
                    job_logs,
                    job_id=job_id,
                    tool_tags=agent_cfg.get("tools") or None,
                    on_tool=lambda actor, name, meta: _emit_job_event(job_id, "tool_call", actor, meta),
                    fleur_context=FLEUR_CONTEXT,
                    memory_context=entity_ctx,
                )
                _raise_if_job_cancelled(job_id)
            elif agent_key == "coordinateur":
                result, t_in_total, t_out_total = orchestrate_coordinateur_mission(
                    mission_txt, mission_plain, job_logs, chat_mode=False, job_id=job_id,
                    cio_questions_enabled=bool(cfg.get("cio_questions_enabled", True)),
                    cio_plan_hitl_enabled=bool(cfg.get("cio_plan_hitl_enabled", True)),
                )
                _raise_if_job_cancelled(job_id)
                if cfg.get("recursive_refinement_enabled"):
                    try:
                        mx = int(cfg.get("recursive_max_rounds") or 0)
                    except (TypeError, ValueError):
                        mx = 0
                    max_cap = _behavior_int("orchestration.cio.refinement_max_rounds_cap", KORYMB_MAX_REFINEMENT_ROUNDS)
                    if max_cap < 1:
                        max_cap = 1
                    mx = max(1, min(max_cap, mx))
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
        "Tu traites une **demande de suite** : nouveaux objectifs, affinage du livrable, taches additionnelles, "
        "corrections ou iteration sans repartir de zero. Reutilise le contexte ci-dessus ; delegue aux sous-agents "
        "si c'est pertinent pour cette suite.\n\n"
        "OBLIGATION DE FORME — commence ta synthese finale par ## BILAN CUMULE (toujours en premier) :\n"
        "Structure en 3 blocs :\n"
        "  A) Ce qui avait deja ete fait (sessions precedentes) — 2 a 4 puces avec chiffres issus du livrable de reference\n"
        "  B) Ce qui a ete fait lors de CETTE session — chiffres et actions concretes\n"
        "  C) Total cumule — bilan global depuis le debut de la mission\n"
        "Format puce : '- [Role] * [N] [action]' (ex: '- Commercial * 12 profils LinkedIn identifies au total').\n"
        "Ce bilan se lit en 30 secondes et reflete le travail total accompli depuis le debut."
    )
    return "\n\n".join(parts) + "\n\n"


