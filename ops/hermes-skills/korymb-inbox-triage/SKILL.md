---
name: korymb-inbox-triage
category: productivity
description: Triage inbox dirigeant Korymb — HITL, clôtures, questions CIO. SQL lecture + API inbox. Résumé actionnable avec liens.
---

# Inbox triage Korymb

Workspace : **`ws-default-legacy`**.

Activer : `eludein-ops-rules`, `korymb-api-bridge`, `korymb-analytics`.

## Workflow

1. **API** (préféré) : `/opt/data/scripts/korymb-api.sh GET /admin/inbox`
2. **SQL complément** si détail manquant :

```bash
/opt/data/scripts/korymb-sql.sh "
SELECT id, status, agent, LEFT(mission,100) mission, updated_at
FROM jobs
WHERE workspace_id='ws-default-legacy'
  AND status = 'awaiting_validation'
ORDER BY updated_at ASC
LIMIT 10
"
```

3. **HITL >48h** :

```bash
/opt/data/scripts/korymb-sql.sh "
SELECT id, status, TIMESTAMPDIFF(HOUR, updated_at, UTC_TIMESTAMP()) AS hours_stale
FROM jobs
WHERE workspace_id='ws-default-legacy'
  AND status = 'awaiting_validation'
  AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 48 HOUR)
LIMIT 10
"
```

## Format livrable

```
📥 Inbox Korymb

Urgent (>48h HITL): N
En attente HITL: N
Notifications non lues: N

Top 3 actions:
1. … → https://korymb.eludein.art/inbox
2. …
3. …
```

## Règles

- **Ne pas** valider HITL ni dismiss sans instruction explicite d'Éric.
- Proposer **1 action** par item, pas d'exécution autonome.
- Lien direct : https://korymb.eludein.art/inbox

## Alertes cron

`eludein-alerts.sh` envoie Telegram si HITL >48h.
