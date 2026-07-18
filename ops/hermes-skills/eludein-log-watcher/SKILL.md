---
name: eludein-log-watcher
category: devops
description: Surveillance logs Hermes agent — ERROR, Traceback, 401. Cron horaire + analyse manuelle.
---

# Log watcher Hermes

Activer `eludein-ops-rules`, `hermes-vps-health`.

## Cron automatique

```bash
/opt/data/scripts/eludein-log-watch.sh
```

Planifié toutes les heures (crontab Élude In Art). Envoie Telegram si seuil dépassé.

Variables optionnelles :

| Variable | Défaut |
|----------|--------|
| `LOG_WATCH_SINCE` | `1h` |
| `LOG_WATCH_ERROR_THRESHOLD` | `15` |

## Analyse manuelle

```bash
docker logs hermes-agent-aoxw-hermes-agent-1 --since 2h 2>&1 | grep -iE 'ERROR|Traceback|401|WARN' | tail -40
```

WebUI :

```bash
docker logs hermes-agent-aoxw-hermes-webui-1 --since 2h 2>&1 | tail -30
```

## Format livrable

```
📋 Logs Hermes ({fenêtre})

Compteur ERROR/Traceback/401: N
Exemples (3 max, sans secrets):
- …

Cause probable: …
Action: …
```

## Règles

- Ne pas exposer tokens, mots de passe, clés API dans le chat.
- Si 401 répétés → vérifier auth dashboard / Telegram / API keys config.
- Correlation avec `eludein-alerts.sh` et skill `hermes-vps-health`.
