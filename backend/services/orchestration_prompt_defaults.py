"""
Defaults for orchestration prompts (CIO plan JSON + CIO final synthesis).

These strings are seeded into the DB table `orchestration_prompts` on startup.
Placeholders use the <<NAME>> convention to avoid Python str.format brace collisions
with arbitrary mission text.
"""

ORCHESTRATION_PROMPT_KEYS: tuple[str, ...] = (
    "cio_plan_json_user",
    "cio_synthesis_with_team_user",
    "cio_synthesis_solo_suffix",
)

DEFAULT_ORCHESTRATION_PROMPTS: dict[str, str] = {
    "cio_plan_json_user": """Mission : <<MISSION_TXT>>

Analyse cette mission et réponds avec ce JSON exact (sans markdown) :
{
  "agents": <<AGENTS_EXAMPLE_JSON>>,
  "sous_taches": <<SOUS_EXAMPLE_JSON>>,
  "synthese_attendue": "ce que le CIO doit produire en synthèse finale"<<CQ_SCHEMA_FIELD>>
}

Règles :
- La clé du dictionnaire de délégation DOIT s'appeler exactement **sous_taches** (sans accent sur le « e »).
  Ne renomme pas ce champ en « sous_tâches », « subtasks » ou « tasks » : le parseur ne les lit qu'en secours.
- Les clés dans "sous_taches" DOIVENT être EXACTEMENT l'une des clés techniques suivantes (minuscules, underscores) : <<KEYS_CSV>>.
  Pas de majuscules (pas "Commercial"), pas de libellés français à la place de la clé.
- Choisis 1 à <<MAX_SUB>> agents VRAIMENT nécessaires (jusqu'à <<MAX_SUB>> si le dirigeant demande un test impliquant chaque rôle).
- Test de communication, « chaque agent », « les différents agents » : une entrée dans "sous_taches" par rôle concerné,
  avec une consigne qui leur demande une courte réponse de confirmation — ne simule pas leurs réponses, fais-les passer.
- Si l'utilisateur demande qu'un rôle précis agisse (ex. « le développeur », « la compta », ou un rôle personnalisé par sa clé),
  tu DOIS inclure la clé correspondante dans sous_taches avec une sous-tâche actionnable.
- Le champ "agents" est optionnel ; s'il est présent, ce doit être **uniquement** le tableau JSON des clés exactes parmi : <<KEYS_CSV>>
  (zéro ou plusieurs entrées). N'invente **aucun** autre identifiant :
  tout texte qui n'est pas une de ces clés est ignoré par le moteur et **aucun** sous-agent ne part.
  **Interdit** dans "agents" : « CIO », « CIO direct », « coordinateur », « solo », « seul », toute variante qui n'est pas une clé de la liste — sinon la délégation réelle échoue.
- Pour une mission sans délégation : "agents": [] **et** "sous_taches": {} — le CIO répondra seul après coup.
- Chaque clé listée dans "agents" DOIT avoir une entrée non vide correspondante dans "sous_taches" (même clé),
  sinon ce rôle ne partira pas.
- Si le dirigeant demande explicitement de solliciter un rôle (ex. « au commercial », « que le dev vérifie »), mets OBLIGATOIREMENT
  la clé correspondante dans "sous_taches" avec la consigne réelle ; ne remplace pas cela par une entrée « CIO seul ».
- Utilise ton JUGEMENT pour décider qui mobiliser : le dirigeant ne doit pas avoir à nommer les agents. Délègue dès qu'un agent apporterait une valeur réelle (recherche, contenu, code, compta), même sans demande explicite.
- Commercial : prospection, recherche LinkedIn/web de contacts/prospects, veille concurrentielle. Community Manager : publications, contenu, réseaux sociaux, stratégie éditoriale. Développeur : code, API, bug, déploiement. Comptable : facturation, TVA, devis, trésorerie.
- Ne mobilise PAS un agent pour "confirmer sa présence" ou "donner un avis général" sans action concrète à produire.
- Pour une question simple que tu peux traiter seul (information générale, synthèse documentaire, réponse directe) : "agents": [] et "sous_taches": {} — réponds en CIO seul, plus rapide et plus économique.
<<CQ_RULE>>
- Ne renvoie pas un JSON vide si une délégation est demandée ou pertinente.""",
    "cio_synthesis_with_team_user": """Mission originale : <<ROOT_MISSION_LABEL>>

Contributions des agents (textes reels executes par le moteur) :
<<CONTRIBUTIONS>>

OBLIGATION DE FORME STRICTE — respecte cet ordre :

1. ## BILAN OPERATIONNEL (TOUJOURS EN PREMIER)
Tableau de bord en 5 a 12 puces avec des CHIFFRES REELS tires des contributions.
Format : - [Role] * [N] [action] — ex: - Commercial * 8 profils LinkedIn identifies
Inclure : prospects identifies (nb + noms/secteurs), messages rediges (nb), posts reseaux sociaux (nb + plateformes),
documents crees (nb + noms), pages web lues (nb), recherches effectuees (nb).
Ne recopie PAS les courriels ou posts en entier dans ce bilan : le dirigeant dispose des textes intégraux dans
l'annexe « Livrables bruts de l'équipe » (blocs `#### LIVRABLE — …` par pièce) ; ici, compte les pièces (nb) et nomme les cibles, pas le corps des messages.
Si rien de concret, le dire. Ce bloc se lit en 20 secondes.

2. Reponses des roles — un sous-paragraphe par agent ci-dessus
(reprends faits et formulations utiles, meme si reponse courte).
Si contribution absente, dis-le.
Si reponse factuelle directe demandee, recopie-la depuis la contribution.

3. Synthese decisionnelle — structuree et actionnable pour le dirigeant.

4. ## QUESTIONS STRATEGIQUES DU CIO (TOUJOURS EN DERNIER — ne pas omettre)
Pose 3 questions ouvertes au dirigeant pour l'ouvrir sur la suite.
Criteres stricts :
  - Question 1 : continuation directe de CETTE mission (approfondir un point precis, ajuster, relancer un axe).
  - Question 2 : nouvelle mission complementaire dans le contexte global d'Elude In Art
    (relie cette mission a la strategie, au produit, au marche, aux autres roles non mobilises).
  - Question 3 : decision ou validation que le dirigeant doit trancher pour avancer
    (une opportunite, un arbitrage, un risque identifie pendant cette mission).
Format : questions numerotees, ton direct CIO vers dirigeant (ex. 'Veux-tu qu'on...', 'Souhaites-tu...', 'Doit-on...'),
contextualisees aux resultats concrets ci-dessus — jamais generiques.
Chaque question doit ouvrir vers une action reelle : mission a lancer, element a valider, cap a donner.""",
    "cio_synthesis_solo_suffix": """

OBLIGATION DE FORME — inclus toujours EN DERNIER, apres ta reponse :

## QUESTIONS STRATEGIQUES DU CIO
Pose 3 questions ouvertes au dirigeant pour l'ouvrir sur la suite :
  - Question 1 : continuation ou approfondissement de CETTE demande.
  - Question 2 : nouvelle mission complementaire dans le contexte global d'Elude In Art
    (relie cette demande a la strategie, au produit, au marche, a un role non encore mobilise).
  - Question 3 : decision ou validation que le dirigeant doit trancher pour avancer.
Ton direct CIO vers dirigeant, questions numerotees, contextualisees — jamais generiques.""",
}
