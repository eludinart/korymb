# Écosystème Élude In Art — mémoire Hermes

Document de référence permanent. **Source miroir :** dépôt banque-skills `tronc/` (resync via `scripts/sync-tronc.ps1 -ToHermesVps`).

## Porteur

- **Éric** — Élude In Art · eludinart@gmail.com
- Site : https://eludein.art
- Posture Fleur : analyse systémique des relations, **pas divination**

## Second cerveau (cœur)

| Nœud | Rôle |
|------|------|
| **Cursor** | Code, PR, refacto |
| **Korymb** | Décisions HITL, missions, mémoire workspace `ws-default-legacy` |
| **Hermes** | Ops, SQL lecture, briefings, smoke, alertes |

Boucle : Hermes voit → Korymb décide → Cursor construit → Coolify déploie → Hermes vérifie → mémoire.

## Applications

| App | URL | Repo | Rôle Hermes |
|-----|-----|------|-------------|
| **Korymb** | https://korymb.eludein.art · API https://api-korymb.eludein.art | github.com/eludinart/korymb | `korymb-sql.sh`, `korymb-api.sh` |
| **Fleur** | https://app-fleurdamours.eludein.art | github.com/eludinart/fleur-amours | `fleur-sql.sh` |
| **Mandala** | https://mandala.eludein.art | github.com/eludinart/workspace-mandala | DB séparée — ne pas confondre |
| **Hermes** | https://hermes.eludein.art · https://hermeswebui.eludein.art | ops dans repo korymb | `/docker/hermes-agent-aoxw/data/` |
| **WP marque** | https://eludein.art | — | contenu / boutique |
| **OpenPlotter** | RPi5 LAN | — | hors VPS |

## Infra VPS (187.124.42.135)

- Hermes compose : `/docker/hermes-agent-aoxw/`
- Conteneur agent : `hermes-agent-aoxw-hermes-agent-1`
- MariaDB Korymb + Fleur : `juehpsnqkm60d2o6dhs38c5t`, base `default`
- MariaDB Mandala : `p11nw75ijqbg4lfzmwbw2m3m` — **NE PAS UTILISER** pour Korymb/Fleur

## Scripts SQL autorisés

```bash
/opt/data/scripts/eludein-db-check.sh
/opt/data/scripts/korymb-sql.sh "SELECT ..."
/opt/data/scripts/fleur-sql.sh "SELECT ..."
```

## Répartition des rôles

| Besoin | Outil |
|--------|-------|
| Code, PR, refacto | Cursor |
| Missions, HITL, livrables | Korymb |
| Ops, SQL, alertes, smoke | Hermes |

## Erreurs passées (ne pas répéter)

- Scripts maison dans `/opt/data/scripts/` avec mauvais passwords
- Diagnostiquer DB cassée alors que `eludein-db-check.sh` = OK
- Root MariaDB / afficher secrets
- Confondre conteneur Mandala et prod Korymb/Fleur

*Sync tronc : 2026-09-30*
