---
name: korymb-api-bridge
category: devops
description: Actions Korymb via API (briefing, inbox, notifications) — jamais SQL pour écrire. Header X-Agent-Secret.
---

# Pont API Korymb

Hermes **agit** sur Korymb via HTTP, pas SQL.

## Prérequis

Variable dans `/opt/data/.env` :

```
KORYMB_AGENT_SECRET=<identique à AGENT_API_SECRET backend>
KORYMB_API_URL=https://api-korymb.eludein.art
```

## Script obligatoire

```bash
/opt/data/scripts/korymb-api.sh METHOD PATH [JSON]
```

## Endpoints utiles (GET)

| Endpoint | Usage |
|----------|-------|
| `/health` | Santé API |
| `/admin/briefing?period=today` | Briefing dirigeant |
| `/admin/inbox` | Inbox HITL enrichie |
| `/admin/notifications?unread_only=true` | Notifications |
| `/actions?status=pending` | File d'envois à valider |

## Écritures autorisées (whitelist script)

| Action | Commande |
|--------|----------|
| Marquer notif lue | `PATCH /admin/notifications/{id}/read` |
| Tout marquer lu | `POST /admin/notifications/mark-all-read` |
| Dismiss inbox | `POST /admin/inbox/dismiss` + JSON body |
| Créer un ticket d'action | `POST /actions` + JSON body |
| Valider / rejeter un envoi | `POST /actions/{id}/resolve` + `{"decision":"approve\|reject"}` |

**Interdit** sans accord explicite d'Éric : lancer missions, reprise audit, learning resolve. **Ne pas** `approve` un ticket d'action (e-mail, agenda, social, WordPress) sans instruction d'Éric.

Le webhook `POST /telegram/webhook` est géré par **Korymb** (bot HITL dédié). Hermes ne doit pas appeler `setWebhook` sur `TELEGRAM_BOT_TOKEN`.

## Exemples

```bash
/opt/data/scripts/korymb-api.sh GET /health
/opt/data/scripts/korymb-api.sh GET '/admin/briefing?period=today'
/opt/data/scripts/korymb-api.sh GET /admin/inbox
```

## Erreurs

| Code | Action |
|------|--------|
| 401 | `KORYMB_AGENT_SECRET` manquant ou incorrect → signaler Éric |
| 503 | Tunnel MariaDB côté API — vérifier stack Korymb Coolify |

## Complément SQL

Lecture analytique → skill `korymb-analytics` + `korymb-sql.sh`.  
Actions métier → **cette skill** uniquement.
