---
name: fleur-growth-snapshot
category: data-science
description: Snapshot croissance Fleur d'ÅmÔurs — inscriptions, check-ins, usage IA, questionnaires. Hebdo ou à la demande.
---

# Fleur growth snapshot

App : https://app-fleurdamours.eludein.art  
Script : `fleur-sql.sh` uniquement.

Activer : `eludein-ops-rules`, `fleur-analytics`.

## Requêtes standard (briefing hebdo)

```bash
/opt/data/scripts/fleur-sql.sh "
SELECT COUNT(*) AS users_total FROM wp_users LIMIT 1
"

/opt/data/scripts/fleur-sql.sh "
SELECT COUNT(*) AS new_7d FROM wp_users
WHERE user_registered >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
LIMIT 1
"

/opt/data/scripts/fleur-sql.sh "
SELECT COUNT(*) AS new_30d FROM wp_users
WHERE user_registered >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
LIMIT 1
"
```

### Check-ins récents

```bash
/opt/data/scripts/fleur-sql.sh "
SELECT DATE(created_at) d, COUNT(*) n FROM wp_fleur_checkins
WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY DATE(created_at) ORDER BY d DESC LIMIT 7
"
```

### Usage IA app (7j)

```bash
/opt/data/scripts/fleur-sql.sh "
SELECT COUNT(*) AS ai_calls_7d FROM wp_fleur_ai_usage_log
WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
LIMIT 1
"
```

### Questionnaires récents

```bash
/opt/data/scripts/fleur-sql.sh "
SELECT COUNT(*) AS results_7d FROM wp_fleur_amour_results
WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
LIMIT 1
"
```

## Format livrable

```
🌸 Fleur — snapshot {période}

Users: total / +7j / +30j
Check-ins 7j: …
IA appels 7j: …
Questionnaires 7j: …

Insight: …
Recommandation: … (sans publier automatiquement)
```

## Privacy

Pas d'export emails en masse. Agrégats uniquement.
