---
name: eludein-ecosystem
category: reference
description: Cartographie des applications Élude In Art — savoir quelle base, quelle skill et quel script utiliser selon le sujet (Korymb, Fleur d'ÅmÔurs, Hermes ops).
---

# Écosystème Élude In Art — routage Hermes

Quand Éric parle de son système, identifier **quelle application** est concernée avant d'agir.

## Applications

| Application | URL | Rôle | Accès données Hermes |
|-------------|-----|------|----------------------|
| **Korymb** | https://korymb.eludein.art | QG IA — missions, agents, HITL, mémoire | `korymb-sql.sh` + skill `korymb-analytics` |
| **Fleur d'ÅmÔurs** | https://app-fleurdamours.eludein.art | App tarot — utilisateurs, questionnaires, coach | `fleur-sql.sh` + skill `fleur-analytics` |
| **Hermes** | https://hermes.eludein.art | Agent ops 24/7 | `/opt/data` (skills, cron, sessions) |

## Routage par sujet

| Sujet / mots-clés | Aller vers |
|-------------------|------------|
| missions, jobs, CIO, HITL, playbooks, tokens LLM, inbox dirigeant | skill `korymb-analytics` + `korymb-sql.sh` |
| utilisateurs tarot, questionnaires, coach, constellations | skill `fleur-analytics` + `fleur-sql.sh` |
| VPS, Docker, Coolify, Traefik, logs, down | skill `hermes-vps-health` |
| analyse croisée, état des lieux global | skill `hermes-db-analysis` |
| post-déploiement, smoke test | skill `hermes-deploy-check` |
| lancer une mission Korymb | API `https://api-korymb.eludein.art` |
| action produit Fleur (compte, paiement) | app `https://app-fleurdamours.eludein.art` |

## Skills à activer selon le sujet

| Sujet | Skill |
|-------|-------|
| **Toujours** | `eludein-ops-rules` |
| Routage écosystème | `eludein-ecosystem` |
| SQL Korymb | `korymb-analytics` |
| SQL Fleur | `fleur-analytics` |
| Santé VPS | `hermes-vps-health` |
| Analyse DB croisée | `hermes-db-analysis` |
| Post-déploiement | `hermes-deploy-check` |

## Scripts SQL (lecture seule) — SEULE MÉTHODE AUTORISÉE

Le **terminal SSH Hermes** s'exécute sur l'**hôte VPS** (`/opt/data/scripts/`).
Ces scripts sont des **wrappers** qui délèguent au conteneur Hermes — ne pas les réécrire.

```bash
# Vérification (lancer EN PREMIER)
/opt/data/scripts/eludein-db-check.sh

# Korymb
/opt/data/scripts/korymb-sql.sh "SELECT ... LIMIT N"

# Fleur d'ÅmÔurs
/opt/data/scripts/fleur-sql.sh "SELECT ... LIMIT N"
```

**Ne jamais** créer tes propres scripts dans `/opt/data/scripts/` sur l'hôte.
**Ne jamais** modifier `/opt/data/.env` sur l'hôte (symlink vers le conteneur).

## INTERDICTIONS ABSOLUES (ne jamais faire)

- **Jamais** `docker exec ... mariadb -uroot` ni afficher de mot de passe root
- **Jamais** `execute_code` Python pour se connecter à MariaDB
- **Jamais** modifier `korymb-sql.sh`, `fleur-sql.sh` ou `/opt/data/.env`
- **Jamais** utiliser le conteneur `p11nw75ijqbg4lfzmwbw2m3m` (MariaDB Mandala)
- **Jamais** `hermes_readonly` pour Fleur — Fleur utilise `hermes_fleur_readonly` via `fleur-sql.sh`
- **Jamais** proposer skip-grant-tables ou réinitialisation root

Si un script échoue : relancer `eludein-db-check.sh`. Si STATUS: OK, le problème vient de ta méthode (Python/root), pas des credentials.

**Ne jamais mélanger** : une question sur les missions Korymb n'utilise pas `fleur-sql.sh`, et inverseur.

## Bases de données (prod VPS)

- **Conteneur unique** : `juehpsnqkm60d2o6dhs38c5t` — base `default`
- **Ne pas utiliser** `p11nw75ijqbg4lfzmwbw2m3m` (MariaDB Mandala, autre projet, vide pour Korymb/Fleur)
- **Ne jamais** `docker exec ... mariadb -uroot` : toujours `korymb-sql.sh` ou `fleur-sql.sh`
- **Korymb** : tables `jobs`, `korymb_workspaces`, `llm_usage_events`, …
- **Fleur** : tables `wp_fleur_*` (WordPress), `wp_users`
- Utilisateurs readonly distincts : `hermes_readonly` (Korymb), `hermes_fleur_readonly` (Fleur)

## Docs

- `docs/KORYMB-DESCRIPTION-HERMES.md` — contexte Korymb
- `docs/HERMES-KORYMB-DATABASE.md` — SQL Korymb
- `docs/HERMES-FLEUR-DATABASE.md` — SQL Fleur
