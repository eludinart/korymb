---
name: eludein-ecosystem
category: reference
description: Cartographie Élude In Art — Korymb, Fleur, Mandala, Hermes, Cursor, OpenPlotter. Routage base/skill/script + boucle second cerveau.
---

# Écosystème Élude In Art — routage Hermes

Identifier **quelle application** est concernée avant d'agir.  
Constitution : activer aussi `eludein-ops-rules`. Boucle Cursor×Hermes×Korymb : `eludein-second-cerveau`.

## Applications

| Application | URL | Rôle | Accès données Hermes |
|-------------|-----|------|----------------------|
| **Korymb** | https://korymb.eludein.art · API https://api-korymb.eludein.art | QG IA — missions, HITL, mémoire | `korymb-sql.sh` + `korymb-api.sh` + `korymb-analytics` |
| **Fleur d'ÅmÔurs** | https://app-fleurdamours.eludein.art | App tarot — users, questionnaires, coach | `fleur-sql.sh` + `fleur-analytics` |
| **Mandala** | https://mandala.eludein.art | Lieux & communautés | MariaDB Mandala `p11nw75ijqbg4lfzmwbw2m3m` — **ne pas** utiliser les scripts Fleur/Korymb |
| **Hermes** | https://hermes.eludein.art · WebUI https://hermeswebui.eludein.art | Agent ops 24/7 | `/opt/data` |
| **Cursor** | Desktop / Cloud Agents | Code, PR, refacto | Repos GitHub `eludinart/*` + banque skills (tronc) |
| **OpenPlotter** | RPi5 LAN | Bateau Ti Spoun | Pas d'accès depuis VPS |
| **Marque WP** | https://eludein.art | Contenu, boutique | Pas de SQL Hermes dédié |

## Repos code (pour orienter Éric / missions)

| App | Repo |
|-----|------|
| Fleur | https://github.com/eludinart/fleur-amours |
| Korymb | https://github.com/eludinart/korymb |
| Mandala | https://github.com/eludinart/workspace-mandala |

## Routage par sujet

| Sujet | Aller vers |
|-------|------------|
| missions, jobs, HITL, inbox, tokens LLM | `korymb-analytics` + `korymb-sql.sh` / API |
| utilisateurs tarot, questionnaires, coach | `fleur-analytics` + `fleur-sql.sh` |
| lieux Mandala, carte communautés | **ne pas** `fleur-sql` / `korymb-sql` — signaler limite ou skill Mandala si ajoutée |
| VPS, Docker, Coolify, down | `hermes-vps-health` + `coolify-services-map` |
| post-déploiement | `hermes-deploy-check` |
| lancer / cadrer travail de fond | skill `eludein-second-cerveau` → Korymb HITL → Cursor |
| code / PR | **Cursor** (pas Hermes) |

## Scripts SQL (lecture seule) — SEULE MÉTHODE

```bash
/opt/data/scripts/eludein-db-check.sh
/opt/data/scripts/korymb-sql.sh "SELECT ... LIMIT N"
/opt/data/scripts/fleur-sql.sh "SELECT ... LIMIT N"
```

**Interdit :** docker exec root MariaDB, Python DB maison, scripts inventés, écritures SQL, confondre conteneur Mandala.

## Second cerveau (résumé)

Hermes observe → Korymb décide (HITL) → Cursor code → Coolify déploie → Hermes smoke → mémoire outcomes.  
Détail : skill `eludein-second-cerveau` + mémoire `ecosystem-eludein.md`.

## Docs repo Korymb

- `docs/KORYMB-DESCRIPTION-HERMES.md`
- `docs/HERMES-KORYMB-DATABASE.md` · `docs/HERMES-FLEUR-DATABASE.md`
- `docs/HERMES-INTELLIGENCE.md`
