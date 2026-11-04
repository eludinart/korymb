# Agent bus — configuration Grok Bot (HTTP)

Canal inter-nœuds Korymb pour **Grok Bot** (`grokbot`), distinct de l’inbox HITL `/admin/inbox`.

## API

- **Base URL :** `https://api-korymb.eludein.art`
- **Auth :** header `X-Agent-Secret: <même secret agent>` que Cursor / Hermes (`AGENT_API_SECRET` côté backend).
- **Secret :** configurer uniquement dans l’app Grok Bot (variables d’environnement ou secrets intégrés). **Ne jamais** committer le secret dans git.
- **Import outils :** coller / importer [`agent-bus-grokbot.openapi.json`](./agent-bus-grokbot.openapi.json) (OpenAPI 3) — remplacer `REPLACE_WITH_AGENT_SECRET` par le secret réel **dans l’app uniquement**.

## Outils HTTP

| Outil | Méthode | Path / body |
|-------|---------|-------------|
| `bus_list` | GET | `/agent-bus/messages?to=grokbot&status=open` |
| `bus_post` | POST | `/agent-bus/messages` — JSON `{ "from": "grokbot", "to": "<cursor\|hermes\|grokbot\|grok\|*>", "topic": "...", "body": "..." }` |
| `bus_ack` | POST | `/agent-bus/messages/{id}/ack` (optionnel) |
| `bus_done` | POST | `/agent-bus/messages/{id}/done` — JSON `{ "comment": "..." }` |

Toutes les requêtes : header `X-Agent-Secret`, `Content-Type: application/json` pour POST avec body.

### `to` autorisés (`bus_post`)

`cursor` | `hermes` | `grokbot` | `grok` | `*` (broadcast ops).

### Exemple de réponse `bus_list`

```json
{
  "messages": [
    {
      "id": "bus-a1b2c3d4e5f6",
      "from": "cursor",
      "to": "grokbot",
      "topic": "mandala-play-review",
      "body": "Surveiller validation Play Store Mandala…",
      "status": "open",
      "reply_to": null,
      "comment": "",
      "created_at": "2026-11-04T15:28:00",
      "updated_at": "2026-11-04T15:28:00"
    }
  ]
}
```

Pour `bus_ack` / `bus_done`, passer l’`id` tel quel (ex. `bus-a1b2c3d4e5f6`) dans le path.

### Convention de réponse (économe)

**Le `comment` de `bus_done` est la réponse.** Ne pas enchaîner un `bus_post to=cursor` sauf si le brief demande explicitement un **nouveau** fil.

- Cursor relit le résultat : `GET /agent-bus/messages?topic=<même topic>&status=done` (éventuellement `to=grokbot`).
- `bus_ack` : **skip** par défaut (un appel de moins) ; utiliser seulement si plusieurs workers concurrents.

## Envoie à Cursor (sans copier-coller)

1. Préparer avec Éric un **plan d’exécution** (texte clair : objectif, étapes, hors scope).
2. Quand Éric dit « envoie à Cursor » : `bus_post` avec `from=grokbot`, `to=cursor`, `topic` (ex. `cursor-task` ou sujet métier), `body` = le plan.
3. **Ne pas** coller le plan dans un chat Cursor à la main — le bus est le canal.
4. Cursor récupère via `GET /agent-bus/messages?to=cursor&status=open` (script `scripts/korymb-api.ps1`).

### Règle dure — Grokbot ne code pas

- **Seul Cursor** modifie le code des apps et gère Git (branches, commits, PR, révisions). GitHub est au centre : un écriture Grokbot sur le repo perturberait les révisions.
- Grokbot : discuter, préparer des plans, poster/lire le bus, rappeler Éric (tel/ordi).
- Le bus transporte des **plans / briefs / rappels** (texte), pas des patches à appliquer hors Cursor.
- Accès Grokbot = header `X-Agent-Secret` vers `/agent-bus/*` uniquement — **aucun** droit d’écriture sur le code, le SSH app, ni Coolify « code ».

## Instruction agent (prompt système ou procédure)

> Tu es le nœud **`grokbot`** du bus Korymb. Tu **ne codes pas** et tu ne touches pas Git : tu prépares des plans et tu discutes. Sur « envoie à Cursor », `bus_post` `to=cursor` avec le plan (topic `cursor-task` ou métier). **À chaque tour**, appelle une fois `bus_list` (`to=grokbot&status=open`). Pour chaque message `open` : exécute la tâche non-code (rappel, info), puis `bus_done` avec un `comment` clair — c’est ta réponse à Cursor. N’utilise pas `bus_ack`. N’utilise `bus_post` que pour démarrer un **nouveau** message (pas pour répondre). Ne traite pas les envois e-mail / social / WordPress — HITL `/actions` uniquement.

## Cycle de vie d’un message

1. Un nœud crée un message (`POST /agent-bus/messages`) → **open**.
2. (Optionnel) **ack** → **acked**.
3. Destinataire **done** + `comment` → **done** (= résultat visible).

## Références

- Skills Hermes : `ops/hermes-skills/eludein-agent-bus`, `ops/hermes-skills/korymb-api-bridge`
- Cursor : skill `korymb-mission-bridge` (section Agent bus)
- OpenAPI : `docs/agent-bus-grokbot.openapi.json`
