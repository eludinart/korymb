# Agent bus — nœud Cursor (background agent)

Canal inter-nœuds Korymb pour **Cursor** (`to=cursor`). Grokbot prépare les plans ; **seul Cursor code**.

Checklist sœur Grok Bot : [`GROKBOT-SETUP.md`](./GROKBOT-SETUP.md) · [`AGENT-BUS-GROKBOT.md`](./AGENT-BUS-GROKBOT.md).

## Objectif

Un **Cloud Agent / Automation Cursor** relève le bus toutes les **15 minutes**, tous les jours de **08:00 à 22:45** (`Europe/Paris`). S’il n’y a aucun message `open` : **silence** (pas de bruit, pas de PR vide).

## API

| Élément | Valeur |
|---------|--------|
| Base URL | `https://api-korymb.eludein.art` |
| Liste | `GET /agent-bus/messages?to=cursor&status=open` |
| Ack | `POST /agent-bus/messages/{id}/ack` |
| Progress | `POST /agent-bus/messages/{id}/progress` — JSON `{ "note": "…" }` |
| Done | `POST /agent-bus/messages/{id}/done` — JSON `{ "comment": "…" }` |
| Auth | header `X-Agent-Secret` |
| Secret | variable d’env `AGENT_API_SECRET` (ou `KORYMB_AGENT_SECRET`) — **jamais** en dur, ni dans un commit, ni dans un `comment` du bus |

Client local de référence : `scripts/korymb-api.ps1`.

## Planification (Automation Cursor)

| Champ | Valeur |
|-------|--------|
| Nom | `Korymb bus — nœud cursor` |
| Description | Relève le bus agent `to=cursor` et traite une tâche à la fois (code + PR brouillon). |
| Trigger | Cron custom |
| Expression | `*/15 8-22 * * *` |
| Fuseau | `Europe/Paris` (dans le sélecteur Automation ; le cron seul n’a pas de TZ) |
| Repo | `eludinart/korymb` |
| Branche de base | `main` (l’agent crée ensuite une branche dédiée par tâche) |

Fenêtre couverte : 08:00, 08:15, …, 22:30, 22:45.

### Secret dans l’agent de fond

Configurer `AGENT_API_SECRET` dans les secrets / env du Cloud Agent (dashboard Cursor), **pas** dans le prompt ni dans le dépôt.

## Prompt système (coller tel quel dans l’Automation)

```
Tu es le nœud cursor du bus Korymb. Ton rôle : coder uniquement. Tu ne discutes pas, tu n'envoies pas d'e-mails, tu n'ouvres pas de social. Tu traites les tâches du bus.

À chaque session, appelle une fois : scripts/korymb-api.ps1 -Method GET -Path "/agent-bus/messages?to=cursor&status=open".

Pour chaque message open (une seule tâche à la fois, priorité au plus ancien ou à celui marqué prioritaire) :
1. POST /agent-bus/messages/{id}/ack
2. Exécute selon le topic :
   - cursor-task : coder sur une branche dédiée (jamais main), ouvrir une PR brouillon, ne jamais merger / push main / déployer sans accord explicite d'Éric.
   - cursor-remind : marquer done avec comment "rappel transmis à Éric" (les reminds sont gérés par GrokBot de son côté ; rare ici).
   - autre topic : done avec un comment qui explique ce qui a été fait, ou pourquoi rien n'a été fait.
   - demande ambiguë ou risquée : done avec une question en comment, sans coder.
3. POST /agent-bus/messages/{id}/done avec un comment (branche, lien PR, résumé, points à tester). Option : /progress pour une tâche longue.

Si le bus est vide : dis-le simplement et arrête-toi (silence).

Secret X-Agent-Secret = variable d'environnement AGENT_API_SECRET (ou KORYMB_AGENT_SECRET). Ne le mets jamais en dur dans le code, les logs, un commit ou un comment du bus.

Hors scope : e-mail, posts social, WordPress (HITL /actions), Coolify / prod sans accord d'Éric.
```

## Traitement des topics

| Topic | Action |
|-------|--------|
| `cursor-task` | ack → coder → PR brouillon → done (comment riche) |
| `cursor-remind` | done + comment `rappel transmis à Éric` |
| autre | done + comment explicatif |
| ambigu / risqué | done + question, **sans** coder |

## Règle dure (Éric)

- Branche dédiée uniquement — **jamais** commit/push sur `main`.
- PR **brouillon** sur `eludinart/korymb` — **ne pas merger**.
- **Ne pas déployer** (Coolify) sans accord explicite.
- Pas d’e-mail / social / WordPress (HITL `/actions`).

## Activation manuelle (checklist)

Cursor ne peut pas toujours créer l’Automation depuis une session IDE classique. Éric (ou une session **Agents Window**) :

1. Cursor → **Automations** → New.
2. Trigger **On a schedule** → custom cron `*/15 8-22 * * *` · TZ `Europe/Paris`.
3. Repo `eludinart/korymb`, env secret `AGENT_API_SECRET`.
4. Coller le prompt ci-dessus.
5. Sauver / activer.

Doc Automation Cursor : [Cloud Agents dashboard](https://cursor.com/dashboard?tab=cloud-agents).

## Test d’acceptation

1. Poster (Grokbot ou script) un `cursor-task` de test `to=cursor`.
2. Attendre au plus une fenêtre de 15 min (ou lancer l’agent à la main une fois).
3. Vérifier : message passé à `acked` puis `done`, PR brouillon ouverte, tâche visible puis clôturée sur `/gestion/taches`.

## Références

- Script : `scripts/korymb-api.ps1`
- Skill : `.cursor/skills/korymb-mission-bridge/SKILL.md` (section Agent bus)
- Grokbot : `docs/AGENT-BUS-GROKBOT.md`, `docs/GROKBOT-SETUP.md`
