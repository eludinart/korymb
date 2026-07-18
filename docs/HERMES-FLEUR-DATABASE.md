# Hermes ↔ Fleur d'ÅmÔurs — accès base de données

> Hermes lit la base MariaDB de **l'app Fleur d'ÅmÔurs** en **lecture seule** pour des analyses opérationnelles (utilisateurs, questionnaires, coach, usage IA).
> Les **écritures** et **actions produit** restent du ressort de l'app (`https://app-fleurdamours.eludein.art`).

## Architecture

```
┌─────────────────┐     réseau coolify      ┌──────────────────────────┐
│ Hermes Agent    │ ────────────────────────▶│ MariaDB (Coolify)        │
│ fleur-sql.sh    │   hermes_fleur_readonly  │ base `default`           │
│                 │   SELECT only            │ wp_fleur_*, wp_users     │
└─────────────────┘                          └──────────────────────────┘
         │                                              ▲
         │                                              │ app Fleur (rw)
         ▼                                              │
┌─────────────────┐                          ┌──────────┴───────────────┐
│ Analyses tarot, │                          │ App Fleur d'ÅmÔurs       │
│ users, coach    │                          │ app-fleurdamours...      │
└─────────────────┘                          └──────────────────────────┘
```

| Composant | Rôle |
|-----------|------|
| **App Fleur d'ÅmÔurs** | Seul writer métier (comptes, questionnaires, coach) |
| **Hermes `hermes_fleur_readonly`** | SELECT uniquement sur `default.*` |
| **`fleur-sql.sh`** | Garde-fou : SELECT/SHOW/DESCRIBE + LIMIT |

> **Distinction Korymb** : Korymb utilise `korymb-sql.sh` et les tables `jobs`, `korymb_*`. Fleur utilise `fleur-sql.sh` et `wp_fleur_*`. Même serveur MariaDB, namespaces différents.

## Installation (VPS)

```powershell
.\scripts\hermes-fleur-db-setup.ps1
```

Le script :

1. crée `hermes_fleur_readonly` sur le conteneur MariaDB ;
2. écrit `FLEUR_DB_*` dans `/docker/hermes-agent-aoxw/data/.env` ;
3. déploie `fleur-sql.sh`, la skill `fleur-analytics` et `eludein-ecosystem`.

## Utilisation dans Hermes

```bash
/opt/data/scripts/fleur-sql.sh "SHOW TABLES LIKE 'wp_fleur_%'"

/opt/data/scripts/fleur-sql.sh "
SELECT ID, user_login, user_registered
FROM wp_users
ORDER BY user_registered DESC
LIMIT 10
"
```

Skill Hermes : `fleur-analytics` — routage global : `eludein-ecosystem`.

## Tables principales

| Zone | Tables |
|------|--------|
| Utilisateurs | `wp_users` |
| Questionnaires | `wp_fleur_amour_results`, `wp_fleur_amour_answers` |
| Chat | `wp_fleur_chat_conversations`, `wp_fleur_chat_messages` |
| Coach | `wp_fleur_coach_invitations`, `wp_fleur_coach_patient_fiches`, `wp_fleur_coach_session_notes` |
| Constellations | `wp_fleur_constellations`, `wp_fleur_constellation_members` |
| Check-ins | `wp_fleur_checkins` |
| IA app | `wp_fleur_ai_usage_log`, `wp_fleur_ai_prompts` |

Environ **73 tables** `wp_fleur_*` en production.

## Anti-confusion Hermes

| Question sur… | Script | Tables |
|---------------|--------|--------|
| Missions, agents, HITL, coûts LLM Korymb | `korymb-sql.sh` | `jobs`, `llm_usage_events`, … |
| Utilisateurs tarot, questionnaires, coach | `fleur-sql.sh` | `wp_fleur_*`, `wp_users` |

## Dépannage

| Symptôme | Action |
|----------|--------|
| `FLEUR_DB_PASSWORD manquant` | Relancer `.\scripts\hermes-fleur-db-setup.ps1` |
| Access denied | Vérifier `hermes_fleur_readonly` : `SHOW GRANTS` |
| Table introuvable | Vérifier préfixe `wp_fleur_` ; `SHOW TABLES LIKE 'wp_fleur_%'` |

---

*Voir aussi : [HERMES-KORYMB-DATABASE.md](HERMES-KORYMB-DATABASE.md), [KORYMB-DESCRIPTION-HERMES.md](KORYMB-DESCRIPTION-HERMES.md)*
