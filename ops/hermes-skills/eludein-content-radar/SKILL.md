---
name: eludein-content-radar
category: productivity
description: Radar contenu — croise missions Korymb (community_manager) et stats Fleur pour suggestions éditoriales. Suggestion uniquement, pas de publication auto.
---

# Content radar Élude In Art

**Suggestion éditoriale** — ne jamais publier automatiquement sur les réseaux.

Activer : `eludein-ops-rules`, `korymb-analytics`, `fleur-analytics`, `fleur-growth-snapshot`.

## Sources

### Missions contenu Korymb (30j)

```bash
/opt/data/scripts/korymb-sql.sh "
SELECT id, status, agent, LEFT(mission,120) mission, updated_at
FROM jobs
WHERE workspace_id='ws-default-legacy'
  AND agent IN ('community_manager','redacteur','marketing')
  AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
ORDER BY updated_at DESC
LIMIT 15
"
```

### Activité Fleur (7j)

Utiliser requêtes de `fleur-growth-snapshot`.

### Cron post Fleur existant

Job Hermes « Post quotidien Fleur » — **ne pas dupliquer**. Proposer compléments, pas remplacement.

## Format livrable

```
📡 Content radar — semaine du {date}

Déjà en cours (Korymb): …
Tendance Fleur: …
Idées (3 max):
1. … (carte / thème / lien app)
2. …
3. …

Note: validation Éric avant publication
```

## Règles

- Respecter le manuel Fleur et la liste blanche de cartes pour les posts tarot.
- Pas de divination — posture systémique / relationnelle.
- Lien app : https://app-fleurdamours.eludein.art
