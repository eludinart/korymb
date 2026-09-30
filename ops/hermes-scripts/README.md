# Hermes scripts (miroirs)

Copies sans secrets des scripts VPS — source live : `/opt/data/scripts/` (wrappers) et `/docker/hermes-agent-aoxw/data/scripts/` (dans le conteneur).

| Fichier | Déploiement cible |
|---------|-------------------|
| `eludein-db-check.sh` | conteneur `/opt/data/scripts/` |
| `host-eludein-db-check.sh` | hôte VPS `/opt/data/scripts/eludein-db-check.sh` |
| `mandala-sql.sh` | conteneur |
| `host-mandala-sql.sh` | hôte |
| `eludein-outcome-append.sh` | conteneur |
| `host-eludein-outcome-append.sh` | hôte |
| `eludein-korymb-open-session.sh` | conteneur / hôte (lit `.env`) |
| `eludein-post-deploy-smoke.sh` | conteneur / hôte |
| `eludein-telegram-send.sh` | lit `TELEGRAM_*` depuis `.env` |
| `eludein-concert-record.sh` | journal concert (append + option Korymb/Telegram) |
| `host-eludein-concert-record.sh` | hôte → conteneur |

Les mots de passe / tokens restent dans `/opt/data/.env` sur le VPS — **jamais** dans git.
