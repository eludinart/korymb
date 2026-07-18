---
name: coolify-services-map
category: reference
description: Carte des services Coolify VPS — conteneurs, URLs, rôles. Évite la confusion Mandala vs prod.
---

# Carte services Coolify (VPS 187.124.42.135)

Source de vérité infra. Activer avec `eludein-ops-rules`.

## Services principaux

| Service | URL | Conteneur / stack | Rôle |
|---------|-----|-------------------|------|
| **Korymb admin** | https://korymb.eludein.art | Coolify app Korymb | QG IA Éric |
| **Korymb API** | https://api-korymb.eludein.art | même stack backend | FastAPI missions |
| **Fleur app** | https://app-fleurdamours.eludein.art | Coolify app Fleur | Tarot utilisateurs |
| **Hermes agent** | https://hermes.eludein.art | `hermes-agent-aoxw-hermes-agent-1` | Ops, cron, Telegram |
| **Hermes WebUI** | https://hermeswebui.eludein.art | `hermes-agent-aoxw-hermes-webui-1` | UI complémentaire |
| **Traefik** | — | `coolify-proxy` | Reverse proxy HTTPS |
| **MariaDB prod** | réseau Docker `coolify` | **`juehpsnqkm60d2o6dhs38c5t`** | Base `default` Korymb + Fleur |

## ⚠️ Piège connu

| Conteneur | Statut |
|-----------|--------|
| `p11nw75ijqbg4lfzmwbw2m3m` | MariaDB **Mandala** — **NE PAS UTILISER** |
| `juehpsnqkm60d2o6dhs38c5t` | MariaDB **prod** Korymb + Fleur |

## Chemins Hermes

| Chemin | Contenu |
|--------|---------|
| `/docker/hermes-agent-aoxw/` | compose + data |
| `/docker/hermes-agent-aoxw/data/` | SOUL, skills, scripts, .env |
| `/opt/data/scripts/` | wrappers hôte → conteneur |

## Vérification rapide

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'hermes|juehps|korymb|fleur|coolify'
cd /docker/hermes-agent-aoxw && docker compose ps
```

## Réseau

Hermes agent est sur **`coolify`** + `default`. Labels Traefik : entrypoint `https`, `traefik.docker.network=coolify`.
