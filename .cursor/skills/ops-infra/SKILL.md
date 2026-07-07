---
name: ops-infra
description: Administration du VPS eludein pour Korymb (Coolify, MariaDB tunnel, prod) et Hermes Agent (docker compose, Traefik, SSH terminal, modèles Mistral). Utiliser pour toute tâche SSH VPS, déploiement Hermes, domaine hermes.eludein.art, tunnel DB, ou dépannage infra lié à ce repo.
---

# Ops infra — Korymb + Hermes

## Quand utiliser cette skill

- Connexion SSH au VPS depuis Cursor / Windows
- Hermes : déploiement, logs, domaine, modèles, `execute_code`, terminal SSH
- Korymb : tunnel MariaDB dev, URLs prod, Coolify
- Traefik / certificats / DNS eludein.art

Référence humaine : `docs/ADMINISTRATION.md`  
Description Korymb pour Hermes : `docs/KORYMB-DESCRIPTION-HERMES.md`  
Scripts : `scripts/vps-ssh.ps1`, `scripts/hermes-vps.ps1`

---

## Inventaire rapide

| Élément | Valeur |
|---------|--------|
| VPS SSH | `root@187.124.42.135` |
| Hermes URL | https://hermes.eludein.art |
| Hermes compose | `/docker/hermes-agent-aoxw/` |
| Hermes données | `/docker/hermes-agent-aoxw/data/` → `/opt/data` |
| Korymb prod app | https://korymb.eludein.art |
| Korymb prod API | https://api-korymb.eludein.art |
| Dev local | frontend `:3000`, backend `:8020`, tunnel DB `:3307` |

---

## Workflow agent (SSH)

```powershell
# Depuis la racine du repo
.\scripts\vps-ssh.ps1
# ou
$env:KORYMB_VPS_SSH = "root@187.124.42.135"
ssh $env:KORYMB_VPS_SSH
```

Commandes non interactives :

```powershell
ssh -o BatchMode=yes root@187.124.42.135 "commande"
```

---

## Hermes — commandes essentielles

```bash
cd /docker/hermes-agent-aoxw

# État
docker compose ps
docker compose logs --tail 50

# Redéployer (après edit compose ou .env Hostinger)
docker compose up -d --force-recreate

# Logs applicatifs (dans le volume)
tail -50 /docker/hermes-agent-aoxw/data/logs/dashboard.log
tail -50 /docker/hermes-agent-aoxw/data/logs/gateway.log

# Config Hermes (dans le conteneur)
docker exec hermes-agent-aoxw-hermes-agent-1 bash -lc 'gosu hermes hermes config show'
```

### Fichiers critiques Hermes

| Fichier | Contenu |
|---------|---------|
| `docker-compose.yml` | Image, Traefik labels, volumes, init-docker-access |
| `.env` | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `TRAEFIK_HOST` |
| `data/.env` | Clés API, `TERMINAL_SSH_*`, `OPENAI_API_KEY`, etc. |
| `data/config.yaml` | Modèle, terminal, custom_providers |
| `data/.ssh/id_ed25519` | Clé SSH Hermes → hôte VPS |
| `init-docker-access.sh` | Ajoute user `hermes` au groupe docker (GID 988) |

### Traefik (Coolify)

- Entrypoint HTTPS : `https` (pas `websecure`)
- Réseau : conteneur sur `coolify` + `default`
- Règle Host typique :
  `Host(\`hermes.eludein.art\`) || Host(\`hermes-agent-aoxw.srv1498916.hstgr.cloud\`)`

### Pièges Hermes (déjà rencontrés)

| Symptôme | Cause | Fix |
|----------|-------|-----|
| Dashboard exit 1 | Pas d'auth `ADMIN_*` | Variables dans compose `.env` |
| HTTP 401 chat | Clé OpenRouter corrompue (`[200~`) | Nettoyer `.env` data |
| Modèles Mistral absents | `provider: custom:mistral` | Utiliser `provider: custom` + `base_url` Mistral |
| `execute_code` docker denied | User hermes hors groupe docker | `init-docker-access.sh` + socket monté |
| Terminal SSH permission denied | Pas de clé dans `/opt/data/.ssh` | Copier `hermes-agent` → `data/.ssh/id_ed25519` |
| `hermes.eludein.art` 503 | Host absent dans Traefik | Ajouter domaine dans label Host |
| Gateway Timeout / 504 | Traefik route via réseau `default` (IP inaccessible) | Label `traefik.docker.network=coolify` |
| `Permission denied: /opt/data/.env` | `.env` édité en root (`root:root` mode 600) | `.\scripts\hermes-vps.ps1 fix-perms` ou `chown 10000:10000 data/.env` ; `init-docker-access.sh` corrige au démarrage |
| Config ignorée | Édition de `/root/.hermes/` | Éditer `data/` sur l'hôte |

---

## Korymb — dev local

```powershell
.\start-dev-cursor.ps1 -MariaDbTunnel
.\stop-dev-cursor.ps1
```

Tunnel seul :

```powershell
.\scripts\mariadb-vps-tunnel.ps1
```

Vérification :

```powershell
curl http://127.0.0.1:8020/health
```

Attendu en mode MariaDB : `database.engine=mariadb`, `database.connected=true`.

Prod : voir `COOLIFY_HARDENING.md`.

### Hermes → base Korymb (lecture seule)

Hermes interroge la MariaDB Korymb via `hermes_readonly` (SELECT uniquement).

```powershell
.\scripts\hermes-korymb-db-setup.ps1   # crée user + déploie script/skill
```

| Élément | Chemin / valeur |
|---------|-----------------|
| Script SQL | `/opt/data/scripts/korymb-sql.sh` |
| Skill | `korymb-analytics` |
| MariaDB | conteneur `juehpsnqkm60d2o6dhs38c5t`, base `default` |
| Workspace prod | `ws-default-legacy` |

Doc : `docs/HERMES-KORYMB-DATABASE.md`

Test depuis le VPS :

```bash
docker exec hermes-agent-aoxw-hermes-agent-1 /opt/data/scripts/korymb-sql.sh \
  "SELECT COUNT(*) AS jobs FROM jobs WHERE workspace_id='ws-default-legacy'"
```

---

## Checklist après changement infra

- [ ] `docker compose ps` → conteneur Up
- [ ] https://hermes.eludein.art → 302 (login)
- [ ] `hermes config show` → modèle / terminal attendus
- [ ] Test SSH terminal : `hostname` → `srv1498916`, `whoami` → `root`
- [ ] `korymb-sql.sh` depuis Hermes si accès DB touché
- [ ] Korymb local `/health` si tunnel DB touché
- [ ] Aucun secret commité
