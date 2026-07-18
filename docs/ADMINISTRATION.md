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

### Hermes WebUI (intégré au compose agent)

| Paramètre | Valeur |
|-----------|--------|
| URL | https://hermeswebui.eludein.art (fallback http://187.124.42.135:3001) |
| Conteneur | `hermes-agent-aoxw-hermes-webui-1` |
| Image | `hermes-webui-local:latest` |
| Agent cible | `http://hermes-agent:4860` (réseau Docker interne) |
| Données partagées | `./data:/opt/data` (même volume que l'agent) |
| Source agent (skills API) | `./hermes-agent-src:/opt/hermes:ro` (sync depuis conteneur agent) |
| État WebUI | `./data/hermes-webui-state` |
| Auth | même mot de passe que le dashboard agent (`ADMIN_PASSWORD` → `HERMES_WEBUI_PASSWORD`) |
| Workspace fichiers | `/opt/data/livrables` (défaut) |

**Espaces WebUI** (onglet Espaces) :

| Space | Chemin | Usage |
|-------|--------|-------|
| **Livrables** | `/opt/data/livrables` | Fichiers produits pour Éric |
| **Sources** | `/opt/data/sources` | Briefs, docs de référence |
| **Travail** | `/opt/data/travail` | Workspace classique, brouillons |
| **rep_tech_hermes** | `/opt/data/rep_tech_hermes` | Technique organisé (symlinks) |

Install / mise à jour des espaces : `.\scripts\hermes-workspace-layout.ps1`

Optimisation complète (agent + WebUI + hôte + smoke) :

```powershell
.\scripts\hermes-optimize.ps1
```

Correction ouverture artefacts (chemins `/opt/data/...` hors workspace) :

```powershell
.\scripts\hermes-webui-artifact-fix.ps1
```

**Accéder aux fichiers** (https://hermeswebui.eludein.art) :
1. **Espaces** (barre latérale) → choisir Livrables, Travail, Sources ou rep_tech_hermes
2. Ou panneau **Espace de travail** → onglet **Fichiers** (suit la session active)
3. Clic droit → **Télécharger**

Ne pas pointer un Space vers `/opt/data` racine (bruit technique) — utiliser **rep_tech_hermes**.

Référence compose repo : `ops/hermes/docker-compose.yml`  
Intégration / redéploiement :

```powershell
.\scripts\hermes-webui-integrate.ps1
```

> Ne pas réinstaller WebUI via `/opt/data/docker-compose-hermes-webui.yml` (stack standalone obsolète).  
> Dashboard agent prod : https://hermes.eludein.art — WebUI : interface complémentaire sur `:3001`.

### Intelligence Hermes (SOUL, skills, runbooks)

Déploiement :

```powershell
.\scripts\hermes-intelligence-deploy.ps1
.\scripts\hermes-cron-install.ps1
```

Skills P0/P1 : `eludein-daily-briefing`, `korymb-api-bridge`, `coolify-services-map`, `korymb-inbox-triage`, `fleur-growth-snapshot`, etc.

Crons : briefing 7h, recap 19h, alertes /3h (Telegram).

Doc : [HERMES-INTELLIGENCE.md](HERMES-INTELLIGENCE.md).

### Optimisation complète (recommandé après changement infra)

Un seul script remet en ordre agent, WebUI, sync hôte `/opt/data`, espaces, modèle Mistral et smoke tests :

```powershell
.\scripts\hermes-optimize.ps1
```

Options : `-SkipIntelligence` (sans redéploiement skills), `-SkipCrons`.

Manuel (VPS) : `bash /tmp/hermes-optimize.sh` après copie des scripts depuis le repo.

**Pont API Korymb** : ajouter `KORYMB_AGENT_SECRET` dans `data/.env` (même valeur que `AGENT_API_SECRET` backend) pour activer `korymb-api.sh`.

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
| `/api/skills` 500 / ModuleNotFoundError `agent` | Monter `./hermes-agent-src:/opt/hermes:ro` + `.\scripts\hermes-webui-integrate.ps1` |

### Accès base Korymb (lecture seule)

Hermes peut interroger la MariaDB Korymb pour des analyses SQL (`hermes_readonly`, SELECT uniquement).

| Élément | Valeur |
|---------|--------|
| Conteneur MariaDB | `juehpsnqkm60d2o6dhs38c5t` |
| Base | `default` |
| Script | `/opt/data/scripts/korymb-sql.sh` |
| Skill | `korymb-analytics` |
| Variables | `KORYMB_DB_*` dans `data/.env` |

Installation : `.\scripts\hermes-korymb-db-setup.ps1` — Doc : [HERMES-KORYMB-DATABASE.md](HERMES-KORYMB-DATABASE.md).

### Accès base Fleur d'ÅmÔurs (lecture seule)

Hermes interroge l'app tarot (`app-fleurdamours.eludein.art`) via `hermes_fleur_readonly` et les tables `wp_fleur_*`.

| Élément | Valeur |
|---------|--------|
| Conteneur MariaDB | `juehpsnqkm60d2o6dhs38c5t` |
| Base | `default` |
| Script | `/opt/data/scripts/fleur-sql.sh` |
| Skills | `fleur-analytics`, `eludein-ecosystem` |
| Variables | `FLEUR_DB_*` dans `data/.env` |

Installation : `.\scripts\hermes-fleur-db-setup.ps1` — Doc : [HERMES-FLEUR-DATABASE.md](HERMES-FLEUR-DATABASE.md).

---

## Scripts PowerShell (repo)

| Script | Rôle |
|--------|------|
| `scripts/vps-ssh.ps1` | Ouvre une session SSH vers le VPS |
| `scripts/hermes-vps.ps1` | Status / logs / restart Hermes à distance |
| `scripts/hermes-intelligence-deploy.ps1` | SOUL, mémoire, skills ops, runbooks |
| `scripts/hermes-korymb-db-setup.ps1` | Accès MariaDB lecture seule Hermes → Korymb |
| `scripts/hermes-fleur-db-setup.ps1` | Accès MariaDB lecture seule Hermes → Fleur d'ÅmÔurs |
| `scripts/mariadb-vps-tunnel.ps1` | Tunnel MariaDB pour dev Korymb |
| `start-dev-cursor.ps1` | Lance Korymb en local (option `-MariaDbTunnel`) |
| `stop-dev-cursor.ps1` | Arrête les processus dev |

---

## Pour les agents Cursor

- Règle persistante : `.cursor/rules/ops-korymb-hermes.mdc`
- Skill détaillée : `.cursor/skills/ops-infra/SKILL.md`

Ne pas committer de secrets. Mettre à jour ce document si l'architecture ou les chemins changent.
