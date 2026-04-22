from __future__ import annotations

from typing import Any


BEHAVIOR_DEFAULTS: dict[str, dict[str, Any]] = {
    "orchestration.routing.delegation_key_aliases": {
        "category": "orchestration",
        "type": "json",
        "label": "Alias clés agents (plan JSON -> rôles canoniques)",
        "value": {
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
        },
    },
    "orchestration.routing.sous_taches_plan_keys": {
        "category": "orchestration",
        "type": "json",
        "label": "Clés JSON acceptées pour sous-tâches",
        "value": [
            "sous_taches",
            "sous_tâches",
            "sous-taches",
            "soustaches",
            "subtasks",
            "tasks",
            "delegations",
            "assignments",
            "agent_tasks",
        ],
    },
    "orchestration.tools.web_research_tool_names": {
        "category": "orchestration",
        "type": "json",
        "label": "Outils preuve recherche web (Commercial)",
        "value": ["web_search", "read_webpage", "search_linkedin"],
    },
    "orchestration.tools.dev_web_research_tool_names": {
        "category": "orchestration",
        "type": "json",
        "label": "Outils preuve recherche web (Développeur)",
        "value": ["web_search", "read_webpage"],
    },
    "orchestration.cio.hitl_wait_max_seconds": {
        "category": "orchestration",
        "type": "int",
        "label": "Timeout attente validation plan CIO (secondes)",
        "value": 7200,
    },
    "orchestration.cio.hitl_poll_interval_seconds": {
        "category": "orchestration",
        "type": "float",
        "label": "Intervalle polling validation plan CIO (secondes)",
        "value": 0.28,
    },
    "orchestration.cio.refinement_max_rounds_cap": {
        "category": "orchestration",
        "type": "int",
        "label": "Boucles max d'affinage CIO",
        "value": 12,
    },
    "orchestration.subagent.commercial_web_mandate_suffix": {
        "category": "orchestration",
        "type": "text",
        "label": "Suffixe obligation outils web (Commercial)",
        "value": (
            "\n\n---\n**Obligation outils (système)** : cette consigne implique des faits ou des pistes sur le terrain / le web. "
            "Tu DOIS invoquer au minimum une fois **`web_search`** avec une requête en français ciblée (métier, zone, thème), "
            "puis si utile **`search_linkedin`** ou **`read_webpage`** sur une URL pertinente des résultats. "
            "Ensuite seulement, livre ta synthèse avec des exemples identifiables (pas de liste inventée sans recherche)."
        ),
    },
    "orchestration.subagent.developer_web_mandate_suffix": {
        "category": "orchestration",
        "type": "text",
        "label": "Suffixe obligation outils web (Développeur)",
        "value": (
            "\n\n---\n**Obligation outils (système)** : cette consigne implique une vérification documentaire ou technique en ligne. "
            "Tu DOIS appeler au minimum une fois **`web_search`** (ou **`read_webpage`** sur une URL fournie), puis synthétiser."
        ),
    },
    "orchestration.subagent.repair_web_tools_suffix": {
        "category": "orchestration",
        "type": "text",
        "label": "Relance si aucun outil web (Commercial)",
        "value": (
            "\n\n---\n**Relance obligatoire (système)** : aucun appel `web_search`, `read_webpage` ou `search_linkedin` "
            "n’a été enregistré pour ton tour. Recommence : exécute d’abord **`web_search`** avec une requête précise, "
            "puis au besoin `read_webpage` ou `search_linkedin`, puis termine par une réponse sourcée."
        ),
    },
    "orchestration.subagent.repair_dev_web_tools_suffix": {
        "category": "orchestration",
        "type": "text",
        "label": "Relance si aucun outil web (Développeur)",
        "value": (
            "\n\n---\n**Relance obligatoire (système)** : aucun appel `web_search` ou `read_webpage` n’a été enregistré. "
            "Utilise **`web_search`** (ou `read_webpage` sur une doc officielle), puis conclus."
        ),
    },
    "orchestration.fallback.prospection_commercial_task": {
        "category": "fallbacks",
        "type": "text",
        "label": "Sous-tâche fallback Commercial (prospection)",
        "value": (
            "Recherche web + LinkedIn public pour la demande du dirigeant ; "
            "liste courte de pistes (structures / contacts publics) et angles d’approche."
        ),
    },
    "orchestration.fallback.chat_named_role_task_template": {
        "category": "fallbacks",
        "type": "text",
        "label": "Template fallback chat pour rôle nommé",
        "value": (
            "Le dirigeant parle au CIO dans le chat ; le CIO te sollicite sur ce tour.\n"
            "Obligation : réponds en français avec un contenu **actionnable** que le CIO pourra recopier tel quel "
            "au dirigeant ; pas de message à un collègue imaginaire, pas de mise en scène du type "
            "« je te confie la mission » ou « récupère l'heure » sans donner l'heure.\n"
            "Si la question est factuelle (ex. l'heure civile) : réponds factuellement "
            "(fuseau Europe/Paris par défaut, format 24 h) dans ta réponse.\n\n"
            "<<CONTEXT>>"
        ),
    },
    "orchestration.synthesis.team_livrable_truncate_chars": {
        "category": "synthesis",
        "type": "int",
        "label": "Troncature annexe livrables équipe (caractères)",
        "value": 14000,
    },
}


def behavior_default_value(key: str) -> Any:
    meta = BEHAVIOR_DEFAULTS.get(key) or {}
    return meta.get("value")

