# Agent bus — configuration Grok Bot (HTTP)

Canal inter-nœuds Korymb pour **Grok Bot** (`grokbot`), distinct de l’inbox HITL `/admin/inbox`.

## API

- **Base URL :** `https://api-korymb.eludein.art`
- **Auth :** header `X-Agent-Secret: <même secret agent>` que Cursor / Hermes (`AGENT_API_SECRET` côté backend).
- **Secret :** configurer uniquement dans l’app Grok Bot (variables d’environnement ou secrets intégrés). **Ne jamais** committer le secret dans git.

## Outils HTTP à créer dans Grok Bot

| Outil | Méthode | Path / body |
|-------|---------|-------------|
| `bus_list` | GET | `/agent-bus/messages?to=grokbot&status=open` |
| `bus_post` | POST | `/agent-bus/messages` — JSON `{ "from": "grokbot", "to": "<cursor\|hermes\|grokbot>", "topic": "...", "body": "..." }` |
| `bus_ack` | POST | `/agent-bus/messages/{id}/ack` |
| `bus_done` | POST | `/agent-bus/messages/{id}/done` — JSON `{ "comment": "..." }` (résultat ou synthèse) |

Toutes les requêtes : header `X-Agent-Secret`, `Content-Type: application/json` pour POST avec body.

## Instruction agent (prompt système ou procédure)

> Tu es le nœud **`grokbot`** du bus Korymb. Poll régulièrement les messages ouverts (`bus_list`). Pour chaque message : `bus_ack`, exécute la tâche demandée, puis `bus_done` avec un commentaire clair (résultat, lien, ou blocage). Tu peux répondre à Cursor ou Hermes via `bus_post` (`from=grokbot`). Ne traite pas les envois e-mail / social / WordPress — ceux-ci passent par HITL `/actions`, pas par le bus.

## Cycle de vie d’un message

1. Un nœud crée un message (`POST /agent-bus/messages`) → statut **open**.
2. Le destinataire **ack** (`POST .../ack`) → **acked** (optionnel selon usage).
3. Le destinataire **done** (`POST .../done` + comment) → **done**.

## Références

- Skills Hermes : `ops/hermes-skills/eludein-agent-bus`, `ops/hermes-skills/korymb-api-bridge`
- Cursor : skill `korymb-mission-bridge` (section Agent bus)
