# Chat Ask / Agent — design

Date : 2026-10-31  
Statut : validé en brainstorming (implémentation à planifier)

## Problème

Le chat Korymb a déjà deux modes d’usage (`quotidien` / `operationnel`), exposés comme **Discussion** / **Ops** dans le tiroir Historique et la feuille « Conversation ». Ce couple joue le même rôle qu’Ask / Agent dans Cursor (réponse vs action), mais le sélecteur est mal placé : hors de la barre de saisie, donc peu découvrable. En mode UI Essentiel, le mode est forcé sur Discussion (`lockQuotidien`), ce qui empêche d’agir.

## Décision

- Renommer les labels UI en **Ask** / **Agent** (comportements inchangés).
- Placer le sélecteur en **pastille dans la barre de saisie** (rangée composer).
- Retirer les doublons du tiroir / feuille Plus.
- En Essentiel : sélecteur **visible** ; Agent = même UI Ops qu’en Avancé (interlocuteur, flottes, préparer un travail).
- Pas de nouveau mode backend ; ids internes `quotidien` | `operationnel` conservés.

## Contrat produit

| Label UI | Id interne | Hint | Comportement |
| --- | --- | --- | --- |
| **Ask** | `quotidien` | Parler avec Korymb, sans lancer d’ops | Comme Discussion aujourd’hui : chrome allégé, chips de reformulation, pas d’ops flottes/missions dans le composer |
| **Agent** | `operationnel` | Flottes, missions, HITL | Comme Ops aujourd’hui : interlocuteur, flottes, HITL, convertir en travail |

- Persistance : clé `localStorage` existante `korymb-chat-use-mode`.
- Essentiel **et** Avancé : bascule Ask/Agent libre ; plus de forçage Ask.
- Hors scope : durcir Ask (zéro outil), mode Plan Cursor, redesign global Essentiel/Avancé.

## UI

Rangée composer :

`[Ask|Agent] [joindre] [textarea…] [voix?] [envoyer]`

- Deux pastilles compactes, `aria-pressed`, `title` = hints.
- Désactivées pendant `pending` / envoi.
- Placeholders : Ask → « Écrire à Korymb » ; Agent → « Message ».
- Interlocuteur : reste dans drawer / More en mode Agent, pas dans la barre de saisie.
- Retirer le bloc Mode de `ChatHistoryDrawer` et `ChatThreadMoreSheet`.

## Technique

Front uniquement :

1. `admin/lib/chatUseMode.ts` — labels/hints Ask/Agent ; ids inchangés.
2. `ChatShell` — props mode + `onChatUseModeChange` ; pastille dans la rangée composer.
3. `admin/app/chat/page.tsx` — supprimer `lockQuotidien` / effet qui force `quotidien` en Essentiel ; brancher le change sur le composer.
4. `ChatHistoryDrawer` + `ChatThreadMoreSheet` — retirer le sélecteur Mode ; conserver interlocuteur / Perso / reste.
5. Backend : aucun changement (payload `chat_use_mode` inchangé).

## Vérification

- Manuel : pastille visible Essentiel + Avancé ; bascule change le chrome ; LS survit au refresh ; plus de sélecteur dans drawer / More.
- Mettre à jour tout test/UI string qui assert « Discussion » / « Ops » ou `lockQuotidien`.
- Pas de nouveau Playwright obligatoire ; smoke navigateur.

## Non-objectifs

- Troisième mode orthogonal Ask/Agent vs Discussion/Ops.
- Changer les prompts ou `tools_enabled` côté backend.
- Déplacer l’interlocuteur dans la barre de saisie.
