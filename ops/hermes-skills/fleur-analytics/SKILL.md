---
name: fleur-analytics
category: data-science
description: Analyses lecture seule sur la base MariaDB de l'app Fleur d'ÅmÔurs (tarot, utilisateurs, questionnaires, coach). Ne jamais écrire en base — déléguer les actions produit à l'app https://app-fleurdamours.eludein.art.
---

# Fleur d'ÅmÔurs Analytics (MariaDB lecture seule)

Cette skill concerne **l'application Fleur d'ÅmÔurs** (`https://app-fleurdamours.eludein.art`) — **pas Korymb**.

- **Korymb** = QG agents IA → script `korymb-sql.sh`, tables `jobs`, `korymb_*`, `biz_*`
- **Fleur d'ÅmÔurs** = app tarot utilisateurs → script `fleur-sql.sh`, tables `wp_fleur_*`, `wp_users`

## Comment se connecter (mode d'emploi Hermes)

**Tu n'as pas besoin de saisir un mot de passe.** Tout est dans `/opt/data/.env` (`FLEUR_DB_*`).

### Méthode obligatoire

```bash
/opt/data/scripts/fleur-sql.sh "SELECT ... LIMIT N"
```

- Autorise **SELECT**, **SHOW**, **DESCRIBE**
- `LIMIT` auto (200) sur les SELECT si absent
- Ne jamais utiliser `korymb-sql.sh` pour les données Fleur

### Test connexion

```bash
/opt/data/scripts/fleur-sql.sh "SELECT COUNT(*) AS fleur_tables FROM information_schema.tables WHERE table_schema='default' AND table_name LIKE 'wp_fleur_%'"
```

### Variables (référence — ne pas afficher le mot de passe)

| Variable | Valeur typique |
|----------|----------------|
| `FLEUR_DB_HOST` | `juehpsnqkm60d2o6dhs38c5t` |
| `FLEUR_DB_NAME` | `default` |
| `FLEUR_DB_USER` | `hermes_fleur_readonly` |
| `FLEUR_DB_APP_URL` | `https://app-fleurdamours.eludein.art` |

> Note infra : Fleur et Korymb partagent le même serveur MariaDB Coolify et la base `default`, mais des **préfixes de tables différents** (`wp_fleur_*` vs `jobs` / `korymb_*`).

## Ce qu'il ne faut **pas** faire

- **Ne jamais** utiliser `docker exec ... mariadb -uroot` — utilise uniquement `fleur-sql.sh`.
- **Ne jamais** cibler `p11nw75ijqbg4lfzmwbw2m3m` (MariaDB Mandala) : conteneur Fleur/Korymb = `juehpsnqkm60d2o6dhs38c5t`.
- Ne pas modifier `fleur-sql.sh` ni `/opt/data/.env` sans demande explicite d'Éric.
- Ne pas afficher `FLEUR_DB_PASSWORD` ni mots de passe root dans le chat.

## Règles impératives

1. **Lecture seule** — pas d'INSERT/UPDATE/DELETE
2. **Ne jamais exposer** : `user_pass`, tokens, emails en masse, données santé/coaching sensibles
3. Préférer **agrégats** (COUNT, GROUP BY) ; LIMIT sur les listes
4. Actions produit (inscription, paiement, contenu) → **app Fleur**, pas SQL
5. Si la question parle de **missions, HITL, agents Korymb** → basculer sur skill `korymb-analytics`

## Tables utiles (préfixe `wp_fleur_`)

| Table / zone | Contenu |
|--------------|---------|
| `wp_users` | Comptes WordPress (utilisateurs app) |
| `wp_fleur_amour_results` | Résultats questionnaires / analyses |
| `wp_fleur_amour_answers` | Réponses aux questionnaires |
| `wp_fleur_chat_conversations`, `wp_fleur_chat_messages` | Chat app |
| `wp_fleur_coach_*` | Coaching, fiches patient, invitations |
| `wp_fleur_constellations` | Constellations systémiques |
| `wp_fleur_checkins` | Check-ins utilisateurs |
| `wp_fleur_broadcasts` | Diffusions / annonces |
| `wp_fleur_ai_usage_log` | Usage IA dans l'app |

Lister toutes les tables Fleur :

```bash
/opt/data/scripts/fleur-sql.sh "SHOW TABLES LIKE 'wp_fleur_%'"
```

## Requêtes types

### Nombre de tables Fleur

```bash
/opt/data/scripts/fleur-sql.sh "
SELECT COUNT(*) AS n FROM information_schema.tables
WHERE table_schema='default' AND table_name LIKE 'wp_fleur_%'
"
```

### Utilisateurs WordPress (sans mot de passe)

```bash
/opt/data/scripts/fleur-sql.sh "
SELECT ID, user_login, user_email, user_registered
FROM wp_users
ORDER BY user_registered DESC
LIMIT 20
"
```

### Résultats récents (questionnaires)

```bash
/opt/data/scripts/fleur-sql.sh "
SELECT * FROM wp_fleur_amour_results
ORDER BY 1 DESC
LIMIT 10
"
```

### Structure d'une table (avant requête complexe)

```bash
/opt/data/scripts/fleur-sql.sh "DESCRIBE wp_fleur_checkins"
```

## Livrable attendu

Pour chaque analyse : préciser **« données Fleur d'ÅmÔurs (app tarot) »**, 3–5 insights, 1 recommandation actionnable via l'app ou pour Éric.

## Doc complète

Repo Korymb : `docs/HERMES-FLEUR-DATABASE.md`
