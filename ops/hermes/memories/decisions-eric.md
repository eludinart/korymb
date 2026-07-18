# Décisions Éric — mémoire permanente Hermes

Document **prioritaire**. Ne pas contredire sans confirmation explicite d'Éric.

## Infra — interdictions

- **Ne jamais** modifier `docker-compose.yml`, labels Traefik, ou `.env` Hermes/Korymb sans accord explicite d'Éric.
- **Ne jamais** utiliser le conteneur MariaDB `p11nw75ijqbg4lfzmwbw2m3m` (Mandala) — prod Korymb + Fleur = `juehpsnqkm60d2o6dhs38c5t`.
- **Ne jamais** `mariadb -uroot`, skip-grant-tables, ni afficher mots de passe.
- Scripts SQL officiels uniquement : `korymb-sql.sh`, `fleur-sql.sh`, `eludein-db-check.sh`.
- Terminal SSH Hermes = **hôte VPS** ; data agent = `/docker/hermes-agent-aoxw/data/`.
- **Fichiers livrables** (md, mp3, pdf…) : **`/opt/data/livrables/`** (WebUI par défaut).
- **Sources** : `/opt/data/sources/` · **Travail** : `/opt/data/travail/`.
- **Technique organisé** : `/opt/data/rep_tech_hermes/` (symlinks vers logs, skills, scripts…) — Space WebUI du même nom.
- Ne pas encombrer la racine `/opt/data/` (technique Hermes brut).

## Korymb

- Workspace production : **`ws-default-legacy`** (slug `default`).
- Écritures / missions / HITL → **API** `https://api-korymb.eludein.art` via `korymb-api.sh`, **jamais SQL**.
- Hermes **observe et briefe** ; Korymb **exécute** les missions multi-agents.
- Inbox dirigeant : https://korymb.eludein.art/inbox

## Fleur d'ÅmÔurs

- App utilisateurs : https://app-fleurdamours.eludein.art
- Posture : analyse systémique des relations, **pas divination**.
- Posts réseaux : cron Fleur existant (10h) — ne pas dupliquer sans accord.

## Répartition des outils

| Besoin | Outil |
|--------|-------|
| Code, PR | Cursor |
| Missions métier | Korymb |
| Ops, SQL lecture, alertes, cron | Hermes |

## Alertes — quand prévenir Éric

- Conteneur down, API health ≠ 200, DB check FAIL
- HITL bloqué >48h
- Coût LLM >5 USD / 24h (seuil actuel)
- Smoke post-deploy en échec

## Secrets

- `KORYMB_AGENT_SECRET` dans `/opt/data/.env` = `AGENT_API_SECRET` backend Korymb (pour `korymb-api.sh`).
- Ne jamais committer ni répéter les secrets dans le chat.

*Dernière sync : juillet 2026*
