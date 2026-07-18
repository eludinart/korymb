---
name: hermes-vps-health
category: devops
description: Runbook santé VPS — Hermes agent, WebUI, Traefik, conteneurs Coolify. Procédure pas à pas, pas d'improvisation.
---

# Runbook — Santé VPS Hermes

Activer `eludein-ops-rules` en parallèle.

## Quand utiliser

- « Est-ce que Hermes tourne ? »
- « Pourquoi hermes.eludein.art ne répond pas ? »
- Check matinal / alerte down

## Procédure (exécuter dans l'ordre)

```bash
# 1. Stack Hermes
cd /docker/hermes-agent-aoxw && docker compose ps

# 2. Logs récents agent (erreurs)
tail -30 /docker/hermes-agent-aoxw/data/logs/dashboard.log
tail -30 /docker/hermes-agent-aoxw/data/logs/gateway.log

# 3. HTTPS agent prod
curl -s -o /dev/null -w "hermes.eludein.art HTTP %{http_code}\n" https://hermes.eludein.art/

# 4. WebUI intégrée
curl -s http://127.0.0.1:3001/health
curl -s -o /dev/null -w "webui HTTPS %{http_code}\n" https://hermeswebui.eludein.art/health

# 5. Bases de données (Korymb + Fleur)
/opt/data/scripts/eludein-db-check.sh
```

## Interprétation

| Code / statut | Signification |
|---------------|---------------|
| compose `Up` | Conteneurs OK |
| hermes.eludein.art `302` | Login dashboard — normal |
| hermes.eludein.art `503/504` | Traefik ou réseau `coolify` — voir ADMINISTRATION.md |
| WebUI `/health` `status: ok` | WebUI OK |
| `eludein-db-check` `STATUS: OK` | DB lecture OK |

## Actions autorisées sans accord Éric

- Relire logs, curl, `docker compose ps`
- Proposer la cause + 1 fix ciblé

## Actions interdites sans accord Éric

- `docker compose up --force-recreate` sans diagnostic
- Modifier labels Traefik
- Redémarrer MariaDB

## Livrable

Synthèse 5 lignes : état agent / WebUI / DB / problème éventuel / action recommandée.
