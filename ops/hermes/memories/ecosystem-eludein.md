# Écosystème Élude In Art — mémoire Hermes

Document de référence permanent. Mettre à jour si architecture change.

## Porteur

- **Éric** — Élude In Art, eludinart@gmail.com
- Site : https://eludein.art
- Posture : Tarot Fleur d'ÅmÔurs = analyse systémique des relations, **pas divination**

## Applications

| App | URL | Base / data | Rôle Hermes |
|-----|-----|-------------|-------------|
| **Korymb** | https://korymb.eludein.art | SQL `jobs`, `korymb_*`, `biz_*` | `korymb-sql.sh`, skill `korymb-analytics` |
| **Fleur d'ÅmÔurs** | https://app-fleurdamours.eludein.art | SQL `wp_fleur_*`, `wp_users` | `fleur-sql.sh`, skill `fleur-analytics` |
| **Hermes agent** | https://hermes.eludein.art | `/docker/hermes-agent-aoxw/data/` | Ops, cron, skills |
| **Hermes WebUI** | https://hermeswebui.eludein.art | même `./data` que agent | UI complémentaire |

Workspace Korymb prod : **`ws-default-legacy`**

## Infra VPS (187.124.42.135)

- Hermes compose : `/docker/hermes-agent-aoxw/`
- Conteneur agent : `hermes-agent-aoxw-hermes-agent-1`
- MariaDB Korymb + Fleur : `juehpsnqkm60d2o6dhs38c5t`, base `default`
- **Ne pas** utiliser `p11nw75ijqbg4lfzmwbw2m3m` (Mandala)

## Scripts SQL autorisés (lecture seule)

```bash
/opt/data/scripts/eludein-db-check.sh   # test global
/opt/data/scripts/korymb-sql.sh "SELECT ..."
/opt/data/scripts/fleur-sql.sh "SELECT ..."
```

Terminal SSH = hôte VPS ; scripts `/opt/data/scripts/` = wrappers vers conteneur.

## Erreurs passées (ne pas répéter)

- Créer scripts maison dans `/opt/data/scripts/` avec mauvais passwords → **interdit**
- Diagnostiquer DB cassée alors que `eludein-db-check.sh` = OK → **interdit**
- Utiliser root MariaDB ou afficher secrets → **interdit**
- Confondre `/opt/data` hôte et `/docker/hermes-agent-aoxw/data/` → **toujours le second pour l'agent**

## Répartition des rôles

| Besoin | Outil |
|--------|-------|
| Code, PR, refacto | Cursor |
| Missions, HITL, livrables | Korymb |
| Ops, SQL, alertes | Hermes |

## Doc repo (référence humaine)

- `docs/KORYMB-DESCRIPTION-HERMES.md`
- `docs/HERMES-KORYMB-DATABASE.md`
- `docs/HERMES-FLEUR-DATABASE.md`
- `docs/ADMINISTRATION.md`

*Dernière sync : juillet 2026*
