---
name: hermes-db-analysis
category: data-science
description: Runbook analyse SQL croisée Korymb + Fleur — toujours eludein-db-check d'abord, puis korymb-sql.sh et fleur-sql.sh.
---

# Runbook — Analyse bases de données

Activer : `eludein-ops-rules`, `eludein-ecosystem`, `korymb-analytics`, `fleur-analytics`.

## Étape 0 (obligatoire)

```bash
/opt/data/scripts/eludein-db-check.sh
```

Si `STATUS: FAIL` → stop, signaler Éric. Si `STATUS: OK` → continuer.

## Korymb (workspace prod `ws-default-legacy`)

```bash
# Missions par statut
/opt/data/scripts/korymb-sql.sh "SELECT status, COUNT(*) n FROM jobs WHERE workspace_id='ws-default-legacy' GROUP BY status LIMIT 20"

# Coût tokens 7 jours
/opt/data/scripts/korymb-sql.sh "SELECT DATE(created_at) AS day, ROUND(SUM(cost_usd),4) AS usd FROM llm_usage_events WHERE workspace_id='ws-default-legacy' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 10"

# Notifications non lues
/opt/data/scripts/korymb-sql.sh "SELECT COUNT(*) AS unread FROM director_notifications WHERE workspace_id='ws-default-legacy' AND read_at IS NULL LIMIT 1"
```

## Fleur d'ÅmÔurs

```bash
# Utilisateurs
/opt/data/scripts/fleur-sql.sh "SELECT COUNT(*) AS users FROM wp_users LIMIT 1"

# Inscriptions 30 jours
/opt/data/scripts/fleur-sql.sh "SELECT COUNT(*) AS new_users FROM wp_users WHERE user_registered >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) LIMIT 1"

# Tables Fleur
/opt/data/scripts/fleur-sql.sh "SELECT COUNT(*) AS fleur_tables FROM information_schema.tables WHERE table_schema='default' AND table_name LIKE 'wp_fleur_%'"
```

## Synthèse croisée (livrable)

Préciser **origine** de chaque chiffre (Korymb vs Fleur). Format :

1. **Korymb** — 3 insights (missions, coûts, inbox)
2. **Fleur** — 3 insights (users, activité)
3. **1 recommandation** actionnable (sans exécuter à la place de Korymb/Fleur)

## Interdit

- Python/pymysql pour SQL
- root MariaDB
- Corrélation inventée sans requête
