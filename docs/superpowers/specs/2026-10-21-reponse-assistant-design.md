# Réponse sur place, discussion avec l'assistant

Date : 2026-10-21

## But

Quand une tâche, un jalon ou une question des Décisions attend une réponse, le dirigeant peut l'écrire dans un champ, ou la préparer en discutant avec l'assistant déjà utilisé par `/chat`. L'enregistrement de la réponse est un geste à part : il ne coche pas la tâche, ne marque pas le jalon fait, et ne lance pas la mission.

## Hors périmètre

- Proposer une réponse en un seul appel, sans discussion.
- Envoyer un e-mail, publier, ou cocher « fait » depuis ce champ.
- Ouvrir la page `/chat` pour répondre.
- Embarquer `ChatShell` (voix, pièces jointes, choix d'interlocuteur, lancement de mission) dans le panneau.
- Choisir un modèle dans cette fonction. Le tour passe par `POST /chat`, qui garde le fournisseur et le modèle des réglages runtime.

## Parcours

Le bloc s'appelle **Votre réponse**.

- Zone de texte, 4000 caractères maximum.
- **Enregistrer** envoie le texte. Le bouton est inactif tant que le texte n'a pas changé. Vider le champ puis enregistrer efface la réponse.
- **Discuter** ouvre le panneau. Sur grand écran, panneau à droite. En dessous du breakpoint `lg`, feuille basse. Fermer le panneau laisse le champ tel quel.
- Le fil est celui de cette demande. Le rouvrir reprend la même conversation.
- Le titre, le commentaire, le client ou le projet, et le brouillon déjà saisi sont donnés au modèle à chaque tour. Ils n'apparaissent pas comme un message de l'utilisateur.
- Chaque message non vide de l'assistant a **Utiliser comme réponse**. Cela copie le texte dans le champ. Le champ reste modifiable. Si le champ contient déjà du texte, une confirmation demande « Remplacer la réponse déjà saisie ? ».
- Après enregistrement, la carte affiche la réponse et la date. Le commentaire (« En attente réponse », 400 caractères dans `TaskEditDialog`) reste un pense-bête distinct.

Le bloc est replié derrière **Répondre**, sauf s'il est déjà ouvert parce que :

- le titre, sans les espaces au début et à la fin, se termine par `?` ;
- le commentaire ou le statut du jalon contient à la fois « attente » et « réponse » ;
- une réponse est déjà enregistrée.

Sur une question des Décisions en texte libre, le champ existe déjà : on y ajoute **Discuter**. Sur une question à cocher, **Discuter** est sur le commentaire libre, pas sur les cases. **Utiliser comme réponse** écrit dans le champ qui a ouvert le panneau.

`ChoiceQuestionnaire` sert aussi dans le chat et les missions. Le bouton **Discuter** n'y est ajouté que lorsque l'appelant le demande (Décisions). Le questionnaire du chat ne discute pas avec lui-même.

## Composants

- `admin/components/director/ReplyComposer.tsx` — champ, **Enregistrer**, **Discuter**, état replié, erreur, « Enregistrement… ».
- `admin/components/director/ReplyDrawer.tsx` — fil court : messages, saisie, envoi, **Utiliser comme réponse**. Il appelle `POST /chat` et enregistre la conversation avec le `PUT /chat/conversations/{id}` déjà utilisé par `admin/lib/chatConversationsApi.ts`. Il ne réutilise pas la page `admin/app/chat/page.tsx`.

Surfaces :

| Endroit | Fichier |
| --- | --- |
| Tâches du briefing | `admin/components/director/TodayTasks.tsx` |
| Liste des tâches | `admin/app/gestion/taches/page.tsx` |
| Jalons du briefing | `MilestoneRow` dans `admin/components/director/BriefingBoard.tsx` |
| Étapes du projet | `admin/app/gestion/projets/[id]/page.tsx` |
| Questions des Décisions | `admin/components/director/InboxActionCard.tsx`, qui passe le bouton à `CioArbitrageQuestionnaire` / `ChoiceQuestionnaire` |

Les deux listes de tâches partagent `ReplyComposer`, pour que la réponse saisie sur Aujourd'hui soit la même sur `/gestion/taches`.

## Tâches

Colonnes ajoutées à `biz_work_tasks` par `ensure_work_task_tables` :

- `reply TEXT NOT NULL DEFAULT ''`
- `reply_at TEXT NOT NULL DEFAULT ''`
- `chat_conversation_id TEXT NOT NULL DEFAULT ''`

`WorkTaskUpdate` accepte `reply` (max 4000) et `chat_conversation_id` (max 64). Une mise à jour de `reply` écrit `reply_at` à l'heure UTC courante, ou le vide si le texte est vide. Elle ne modifie pas `status`, `notes`, ni `urgent`.

`BizWorkTask` et `businessApi.updateTask` exposent ces trois champs.

Supprimer une tâche ne supprime pas la conversation. Elle reste dans l'historique du chat.

## Jalons

La réponse vit sur l'objet JSON de l'étape, à côté de `label` et `done` :

- `reply` (texte, max 4000)
- `reply_at`
- `chat_conversation_id`

Route nouvelle, à côté de la coche existante :

`POST /business/projects/{project_id}/milestones/{index}/reply`

Corps : `{ "reply": "...", "label": "..." }`. `label` est le libellé affiché. Même garde que `set_project_milestone_done` : index hors liste → 404, libellé différent → 409 « Cette étape a changé. Rechargez Aujourd'hui. » La route ne change pas `done`. Une réponse vide efface `reply` et `reply_at`.

`build_project_milestones` recopie `reply`, `reply_at` et `chat_conversation_id` sur chaque ligne renvoyée au briefing.

La fiche projet recharge aujourd'hui les étapes en `{ label, done }` et les réécrit ainsi. Cet enregistrement doit renvoyer aussi `reply`, `reply_at` et `chat_conversation_id`, sinon la réponse disparaît. Le compositeur est affiché sous chaque étape de `admin/app/gestion/projets/[id]/page.tsx`.

## Décisions

Le panneau remplit le champ déjà présent. Il n'appelle pas `record_cio_arbitrage_answer` : cet appel écrit le fil de mission et peut marquer la question répondue.

Brouillon, route nouvelle :

`PUT /jobs/{job_id}/cio-question-drafts`

Corps : `{ "question": "...", "answer": "...", "conversation_id": "..." }`.

Effet : sur l'événement `cio_question` dont la liste `questions` contient ce libellé, ou dont la clé est la consigne libre, écrire `draft_answers[question]` et, si fourni, `reply_conversation_id`. Ne pas ajouter d'événement `cio_arbitrage_answer`. Ne pas mettre `answered` à vrai. Ne pas toucher `question_answers`. Réponse vide : retirer cette clé de `draft_answers`.

À l'ouverture, le champ texte prend la réponse déjà validée s'il y en a une, sinon le brouillon. **Valider et lancer** continue d'utiliser l'enregistrement actuel, avec le texte affiché dans le champ. Une question à cocher n'a pas de brouillon de cases. Le commentaire libre est brouillonné sous la clé déjà utilisée à la validation, `CIO_FREE_CONSIGNE_QUESTION` (`Consigne libre (hors propositions CIO)`), même si ce libellé n'est pas dans `questions`.

Une carte Décisions partage une conversation (`reply_conversation_id` sur l'événement). **Utiliser comme réponse** vise le champ qui a ouvert le panneau.

## Chat

1. Au premier **Discuter**, le client crée un id `rcv-` + 12 hex, titre `Réponse · ` + le titre tronqué à 80 caractères, messages vides, via `PUT /chat/conversations/{id}`.
2. Il enregistre cet id sur la tâche, le jalon ou le brouillon de question.
3. Chaque tour est `POST /chat` avec `message`, `history`, `chat_session_id` et `reply_context`.
4. Le client réécrit ensuite la conversation avec le `PUT` existant, comme la page chat.

`ChatRequest` gagne `reply_context: str`, max 4000, vide par défaut. `_build_chat_mission_txt` le place en tête sous « Sujet de la réponse à préparer : », devant le résumé de session et les échanges. `reply_context` n'est pas copié dans `messages_json`.

Le titre de conversation le rend visible dans l'historique de `/chat`. Depuis cet historique, la discussion continue avec le chat complet. Le bouton **Utiliser comme réponse** n'existe que dans le panneau. Revenir au panneau relit la même conversation.

`reply_context` contient, chaque ligne omise si vide :

- le type : Tâche, Jalon ou Question
- le titre
- le commentaire ou le statut
- le client ou le projet
- le brouillon actuel

Le panneau affiche chargement, erreur d'envoi, et l'absence de réponse. Un message assistant vide n'a pas de bouton **Utiliser comme réponse**. Une panne du modèle suit le chemin dégradé déjà présent sur `POST /chat` ; le champ de réponse n'est pas modifié.

## Erreurs

- Échec d'enregistrement : le texte reste dans le champ, le message d'erreur s'affiche, le panneau reste ouvert s'il l'était.
- Échec du tour de chat : le message d'erreur est dans le fil, le champ est inchangé.
- Remplacement : confirmation explicite, **Annuler** ne change rien.
- Deux enregistrements proches : le dernier gagne, comme pour le commentaire aujourd'hui.
- Jalon dont le libellé a bougé : 409, aucun écrit.

## Vérification

Backend, `pytest` :

- Mettre à jour `reply` ne change pas `status` ni `notes`. Une chaîne de 4001 caractères est refusée. Une réponse vide efface `reply_at`.
- `POST .../reply` écrit le JSON de l'étape, laisse `done` tel quel, et répond 409 si le libellé ne correspond pas.
- Enregistrer un projet avec des étapes qui portent `reply` conserve ces champs.
- `PUT .../cio-question-drafts` remplit `draft_answers` et `reply_conversation_id`, n'ajoute pas `cio_arbitrage_answer`, et laisse `answered` faux.
- `_build_chat_mission_txt` place `reply_context` en tête du texte de mission. Le `PUT` de conversation n'écrit que les tours utilisateur et assistant.

Navigateur, sur le briefing, `/gestion/taches`, la fiche projet et une question des Décisions :

- saisir et enregistrer une réponse ;
- ouvrir **Discuter**, envoyer un message, **Utiliser comme réponse**, confirmer le remplacement, enregistrer ;
- recharger : le texte et le fil sont encore là ;
- enregistrer la fiche projet : la réponse du jalon est encore là ;
- **Valider et lancer** reste le seul geste qui enregistre la réponse CIO sur le fil de mission.

## Ordre

1. `reply_context` sur `POST /chat`, colonnes tâche, `ReplyComposer`, `ReplyDrawer`, branchement briefing et `/gestion/taches`.
2. Route jalon, conservation à l'enregistrement du projet, compositeur sur le briefing et la fiche projet.
3. Brouillon CIO et bouton **Discuter** sur les Décisions.
