---
name: hermes-deploy-check
category: devops
description: Runbook post-déploiement Korymb et Hermes — smoke tests HTTP, DB, health API.
---

# Runbook — Post-déploiement

Activer `eludein-ops-rules`.

## Korymb prod

```bash
curl -s -o /dev/null -w "korymb app %{http_code}\n" https://korymb.eludein.art/
curl -s -o /dev/null -w "korymb api %{http_code}\n" https://api-korymb.eludein.art/health
```

Attendu : app `200` ou `302`, API `200` avec `"status":"ok"`.

## Hermes

```bash
curl -s -o /dev/null -w "hermes %{http_code}\n" https://hermes.eludein.art/
curl -s http://127.0.0.1:3001/health
curl -s -o /dev/null -w "webui HTTPS %{http_code}\n" https://hermeswebui.eludein.art/health
cd /docker/hermes-agent-aoxw && docker compose ps
```

## Bases de données

```bash
/opt/data/scripts/eludein-db-check.sh
```

## Smoke script repo (depuis machine avec Node)

```bash
node tools/smoke-post-deploy.mjs --app-url "https://korymb.eludein.art" --backend-url "https://api-korymb.eludein.art"
```

## Livrable

Checklist ✅/❌ : Korymb app, Korymb API, Hermes HTTPS, WebUI, DB check.

Si échec : 1 cause probable + 1 action (pas de refactor massif).
