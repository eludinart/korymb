"""
Définitions par défaut des réglages « Comportements moteur ».

Ce module est la source de vérité des clés connues : libellés, descriptions lisibles
pour l’admin, types et valeurs par défaut. Au démarrage, `database.seed_behavior_defaults`
insère en base uniquement les clés absentes (les valeurs déjà en base ne sont pas écrasées).

Les valeurs sont lues à l’exécution par `services.mission` (orchestration) via
`get_behavior_setting` avec repli sur ces défauts.
"""

from __future__ import annotations

from typing import Any


BEHAVIOR_DEFAULTS: dict[str, dict[str, Any]] = {
    "orchestration.routing.delegation_key_aliases": {
        "category": "orchestration",
        "type": "json",
        "label": "Alias clés agents (plan JSON → rôles canoniques)",
        "description": (
            "Quand le modèle renvoie un plan JSON, les noms de rôles peuvent être approximatifs "
            "(ex. « sales », « dev », « compta »). Ce dictionnaire mappe chaque variante normalisée "
            "(minuscules, sans accents) vers la clé technique exacte du moteur (commercial, "
            "community_manager, developpeur, comptable). Si tu supprimes ou casses une entrée, "
            "le plan peut ne plus déléguer au bon agent."
        ),
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
        "description": (
            "Le parseur fusionne les sous-tâches depuis toutes ces clés au niveau racine du JSON "
            "(ex. « sous_tâches » avec accent, « subtasks », « tasks »). Si tu retires une clé que "
            "le modèle utilise encore, les consignes peuvent être ignorées et aucun sous-agent ne part."
        ),
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
        "label": "Outils « preuve web » (Commercial)",
        "description": (
            "Liste des noms d’outils comptabilisés comme recherche web / LinkedIn pour le rôle Commercial. "
            "Sert à la détection « mandat web », aux relances automatiques et aux avertissements de livrable. "
            "Les noms doivent correspondre exactement aux outils exposés au modèle."
        ),
        "value": ["web_search", "read_webpage", "search_linkedin"],
    },
    "orchestration.tools.dev_web_research_tool_names": {
        "category": "orchestration",
        "type": "json",
        "label": "Outils « preuve web » (Développeur)",
        "description": (
            "Même logique que pour le Commercial, mais pour le Développeur (souvent doc / StackOverflow). "
            "Utilisé pour les relances et les alertes si la consigne suggère une vérif en ligne."
        ),
        "value": ["web_search", "read_webpage"],
    },
    "orchestration.cio.hitl_wait_max_seconds": {
        "category": "orchestration",
        "type": "int",
        "label": "Itérations max en attente validation plan CIO",
        "description": (
            "Nombre maximum de tours de la boucle d’attente quand le plan CIO est en validation dirigeant (HITL). "
            "À chaque tour le moteur relit le job puis attend `hitl_poll_interval_seconds`. "
            "Durée approximative avant « délai dépassé » ≈ ce nombre × l’intervalle (ex. 7200 × 0,28 s ≈ 33 min). "
            "Le nom de la clé contient encore « seconds » pour compatibilité ; la valeur est bien un compte d’itérations."
        ),
        "value": 7200,
    },
    "orchestration.cio.hitl_poll_interval_seconds": {
        "category": "orchestration",
        "type": "float",
        "label": "Intervalle polling validation plan CIO (secondes)",
        "description": (
            "Pause entre deux lectures du statut du job pendant l’attente HITL. Plus petit = réactivité "
            "un peu meilleure mais plus de requêtes base ; plus grand = moins de charge mais sensation "
            "de latence après validation."
        ),
        "value": 0.28,
    },
    "orchestration.cio.refinement_max_rounds_cap": {
        "category": "orchestration",
        "type": "int",
        "label": "Plafond boucles d’affinage CIO",
        "description": (
            "Plafond absolu sur le nombre de tours « boucle d’affinage » (critique CIO puis replanification), "
            "même si la config mission demande plus. Protège coût et durée. La valeur effective est le minimum "
            "entre ce plafond et `recursive_max_rounds` sur le job."
        ),
        "value": 12,
    },
    "orchestration.subagent.commercial_web_mandate_suffix": {
        "category": "orchestration",
        "type": "text",
        "label": "Suffixe obligation outils web (Commercial)",
        "description": (
            "Texte ajouté à la consigne utilisateur du Commercial lorsque le moteur détecte un besoin "
            "de pistes / web / LinkedIn. Force l’usage d’outils de recherche avant la synthèse. Modifier "
            "change le ton et les outils exigés ; supprimer peut réduire la qualité sourcée."
        ),
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
        "description": (
            "Comme pour le Commercial, mais pour les consignes orientées documentation / vérif technique en ligne."
        ),
        "value": (
            "\n\n---\n**Obligation outils (système)** : cette consigne implique une vérification documentaire ou technique en ligne. "
            "Tu DOIS appeler au minimum une fois **`web_search`** (ou **`read_webpage`** sur une URL fournie), puis synthétiser."
        ),
    },
    "orchestration.subagent.repair_web_tools_suffix": {
        "category": "orchestration",
        "type": "text",
        "label": "Relance si aucun outil web (Commercial)",
        "description": (
            "Si un mandat web était détecté mais aucun appel d’outil « preuve » n’a été enregistré après "
            "le premier tour LLM, ce texte est concaténé et un second tour est lancé. Ajuste pour changer "
            "le message de contrainte ou désamorcer la relance (texte vide = pas de relance utile si tu "
            "retires aussi la logique côté code — ici seul le texte est configurable)."
        ),
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
        "description": (
            "Équivalent développeur de la relance « preuve web » : second tour si aucun web_search/read_webpage."
        ),
        "value": (
            "\n\n---\n**Relance obligatoire (système)** : aucun appel `web_search` ou `read_webpage` n’a été enregistré. "
            "Utilise **`web_search`** (ou `read_webpage` sur une doc officielle), puis conclus."
        ),
    },
    "orchestration.fallback.prospection_commercial_task": {
        "category": "fallbacks",
        "type": "text",
        "label": "Sous-tâche fallback Commercial (prospection)",
        "description": (
            "Quand aucune sous-tâche exploitable n’est reconnue mais la mission ressemble à de la prospection, "
            "le moteur injecte cette consigne minimale pour le Commercial. C’est un filet de sécurité : "
            "le texte définit ce que le Commercial fera par défaut dans ce cas."
        ),
        "value": (
            "Recherche web + LinkedIn public pour la demande du dirigeant ; "
            "liste courte de pistes (structures / contacts publics) et angles d’approche."
        ),
    },
    "orchestration.fallback.chat_named_role_task_template": {
        "category": "fallbacks",
        "type": "text",
        "label": "Template fallback chat (rôle nommé)",
        "description": (
            "En mode chat, si le dirigeant nomme un rôle (ex. « le commercial ») mais la sous-tâche du plan "
            "est vide ou métanarrative, ce modèle remplace la consigne. Le placeholder <<CONTEXT>> est remplacé "
            "par le contexte mission tronqué ; garde-le si tu veux injecter le contexte à un endroit précis."
        ),
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
        "description": (
            "Dans la synthèse finale, une annexe markdown reprend les textes bruts des sous-agents. "
            "Ce nombre limite la longueur par rôle avant troncature (affiche « suite tronquée »). "
            "Augmenter grossit le résultat mission ; diminuer allège mais peut couper des détails."
        ),
        "value": 52000,
    },
}


def behavior_default_value(key: str) -> Any:
    meta = BEHAVIOR_DEFAULTS.get(key) or {}
    return meta.get("value")
