# Administration — Korymb & Hermes (VPS eludein)

Ce document centralise l'exploitation de **Korymb** (application) et **Hermes Agent** (agent IA) sur le même VPS Hostinger/Coolify.

> Les mots de passe et clés API ne sont **pas** stockés ici. Ils se trouvent sur le serveur dans les fichiers `.env` indiqués ci-dessous.

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│  VPS 187.124.42.135 (srv1498916)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Coolify      │  │ Traefik      │  │ Hermes Agent     │  │
│  │ Korymb prod  │  │ coolify-proxy│  │ docker compose   │  │
│  │ MariaDB      │  │ :443         │  │ :4860            │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │ tunnel SSH :3307 (dev)             │ https://hermes.eludein.art
         │                                    │
┌────────┴────────────────────────────────────┴───────────────┐
│  Poste dev Windows — repo korymb (Cursor)                   │
│  .\start-dev-cursor.ps1 -MariaDbTunnel                      │
│  admin :3000  ·  backend :8020                              │
└─────────────────────────────────────────────────────────────┘
```

## Accès SSH

| Paramètre | Valeur |
|-----------|--------|
| Hôte | `187.124.42.135` |
| Utilisateur | `root` |
| Variable locale | `$env:KORYMB_VPS_SSH` (défaut `root@187.124.42.135`) |

Depuis Cursor (terminal intégré) :

```powershell
.\scripts\vps-ssh.ps1
```

---

## Korymb

### Développement local (Windows)

| Composant | URL / port |
|-----------|------------|
| Frontend Next | http://127.0.0.1:3000 |
| Backend FastAPI | http://127.0.0.1:8020 |
| Health | http://127.0.0.1:8020/health |
| Tunnel MariaDB | `127.0.0.1:3307` → VPS |

Démarrage :

```powershell
.\start-dev-cursor.ps1 -MariaDbTunnel
```

Arrêt : `Ctrl+C` ou `.\stop-dev-cursor.ps1`.

Guide détaillé : [DEMARRAGE.md](DEMARRAGE.md).

### Production (Coolify)

| Service | URL |
|---------|-----|
| Application | https://korymb.eludein.art |
| API | https://api-korymb.eludein.art |

Guide déploiement : [COOLIFY_HARDENING.md](../COOLIFY_HARDENING.md).

Smoke test post-déploiement :

```bash
node tools/smoke-post-deploy.mjs --app-url "https://korymb.eludein.art" --backend-url "https://api-korymb.eludein.art"
```

---

## Hermes Agent

### URLs

| URL | Usage |
|-----|--------|
| https://hermes.eludein.art | **Domaine principal** (recommandé) |
| https://hermes-agent-aoxw.srv1498916.hstgr.cloud | Hostname Hostinger (fallback) |

Identifiants dashboard : fichier `/docker/hermes-agent-aoxw/.env` sur le VPS (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).

### Arborescence sur le VPS

```
/docker/hermes-agent-aoxw/
├── docker-compose.yml      # Déploiement + labels Traefik
├── .env                    # Auth dashboard Hostinger (ADMIN_*)
├── init-docker-access.sh   # Init groupe docker pour user hermes
└── data/                   # HERMES_HOME (monté /opt/data)
    ├── .env                # Clés API, TERMINAL_SSH_*, etc.
    ├── config.yaml         # Modèle, terminal, providers
    ├── .ssh/id_ed25519     # Clé SSH vers l'hôte VPS
    └── logs/               # dashboard.log, gateway.log, …
```

### Commandes courantes

```bash
cd /docker/hermes-agent-aoxw

docker compose ps
docker compose logs -f --tail 100
docker compose up -d --force-recreate   # après modification compose

# Depuis Windows
.\scripts\hermes-vps.ps1 status
.\scripts\hermes-vps.ps1 logs
.\scripts\hermes-vps.ps1 restart
```

### Configuration actuelle (référence)

| Paramètre | Valeur |
|-----------|--------|
| Image | `ghcr.io/hostinger/hvps-hermes-agent:latest` |
| Modèle | `custom` → Mistral (`mistral-large-latest`) |
| Terminal | `ssh` → `root@10.0.3.1` (passerelle Docker) |
| execute_code | Docker (socket monté + init-docker-access) |
| Réseaux Docker | `coolify`, `default` |

### Traefik

Le proxy Coolify (`coolify-proxy`, Traefik v3) expose les services via labels Docker.

Points importants :

- Entrypoint : **`https`** (ne pas utiliser `websecure`)
- Certificats : `letsencrypt` (HTTP challenge sur entrypoint `http`)
- Règle Host doit inclure `hermes.eludein.art`

Exemple de label :

```yaml
traefik.docker.network=coolify
traefik.http.routers.${COMPOSE_PROJECT_NAME}.rule=Host(`hermes.eludein.art`) || Host(`${COMPOSE_PROJECT_NAME}.${TRAEFIK_HOST}`)
```

Le label `traefik.docker.network=coolify` est **obligatoire** : sans lui, Traefik tente le backend sur le réseau `default` (IP `10.0.3.x`), inaccessible depuis `coolify-proxy` → Gateway Timeout.

### Dépannage rapide

| Problème | Action |
|----------|--------|
| 503 sur hermes.eludein.art | Vérifier label Traefik + réseau `coolify` |
| Gateway Timeout / 504 | Ajouter `traefik.docker.network=coolify` dans les labels compose |
| `Permission denied: /opt/data/.env` | `chown 10000:10000 /docker/hermes-agent-aoxw/data/.env` |
| Conteneur Exited (1) | `tail data/logs/dashboard.log` — souvent auth dashboard manquante |
| Chat HTTP 401 | Vérifier clés dans `data/.env` (pas de `[200~` dans les valeurs) |
| execute_code échoue | `docker.sock` monté + `init-docker-access.sh` actif |
| SSH terminal échoue | Clé dans `data/.ssh/`, `terminal.backend: ssh` dans config |
| Modèles absents | `provider: custom`, cache `data/provider_models_cache.json` |

### Accès base Korymb (lecture seule)

Hermes peut interroger la MariaDB Korymb pour des analyses SQL (`hermes_readonly`, SELECT uniquement).

| Élément | Valeur |
|---------|--------|
| Conteneur MariaDB | `juehpsnqkm60d2o6dhs38c5t` |
| Base | `default` |
| Script | `/opt/data/scripts/korymb-sql.sh` |
| Skill | `korymb-analytics` |
| Variables | `KORYMB_DB_*` dans `data/.env` |

Installation / mise à jour depuis Windows :

```powershell
.\scripts\hermes-korymb-db-setup.ps1
```

Doc détaillée : [HERMES-KORYMB-DATABASE.md](HERMES-KORYMB-DATABASE.md).

---

## Scripts PowerShell (repo)

| Script | Rôle |
|--------|------|
| `scripts/vps-ssh.ps1` | Ouvre une session SSH vers le VPS |
| `scripts/hermes-vps.ps1` | Status / logs / restart Hermes à distance |
| `scripts/hermes-korymb-db-setup.ps1` | Accès MariaDB lecture seule pour Hermes |
| `scripts/mariadb-vps-tunnel.ps1` | Tunnel MariaDB pour dev Korymb |
| `start-dev-cursor.ps1` | Lance Korymb en local (option `-MariaDbTunnel`) |
| `stop-dev-cursor.ps1` | Arrête les processus dev |

---

## Pour les agents Cursor

- Règle persistante : `.cursor/rules/ops-korymb-hermes.mdc`
- Skill détaillée : `.cursor/skills/ops-infra/SKILL.md`

Ne pas committer de secrets. Mettre à jour ce document si l'architecture ou les chemins changent.
