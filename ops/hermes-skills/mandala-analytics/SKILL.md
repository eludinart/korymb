---
name: mandala-analytics
category: devops
description: Analyses SQL lecture seule Mandala (communautés, membres, events, ressources). Utiliser mandala-sql.sh uniquement.
---

# Mandala analytics (Hermes)

Base : conteneur `p11nw75ijqbg4lfzmwbw2m3m`, tables `mdl_*`.
Script : `/opt/data/scripts/mandala-sql.sh` — SELECT/SHOW/DESCRIBE only.

## Exemples

```bash
/opt/data/scripts/mandala-sql.sh "SELECT id, name, slug FROM mdl_mandala_communities ORDER BY id LIMIT 20"

/opt/data/scripts/mandala-sql.sh "SELECT COUNT(*) n FROM mdl_mandala_community_members"

/opt/data/scripts/mandala-sql.sh "SELECT COUNT(*) n FROM mdl_events WHERE starts_at >= CURDATE()"
```

## Anti-confusion

| App | Script | Conteneur |
|-----|--------|-----------|
| Korymb/Fleur | korymb-sql / fleur-sql | `juehpsnqkm60d2o6dhs38c5t` |
| Mandala | mandala-sql | `p11nw75ijqbg4lfzmwbw2m3m` |

Jamais mélanger. Activer aussi `eludein-ops-rules` + `eludein-ecosystem`.
