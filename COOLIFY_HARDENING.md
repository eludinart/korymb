# Coolify Production Hardening

Guide de déploiement **deux services** (frontend Next.js + backend FastAPI) avec auth utilisateurs multi-tenant.

## 1) Frontend Service (racine du repo — `Dockerfile`)

> **Build pack Coolify : `Dockerfile`** (pas Nixpacks). Chemin Dockerfile : `/Dockerfile`, contexte : racine du repo.
> Si les logs mentionnent `nixpacks plan` ou `nix-env`, le service est encore en mode Nixpacks — voir §7.

Variables Coolify (runtime) :

| Variable | Obligatoire | Description |
|---|---|---|
| `PORT` | oui | `3000` |
| `NODE_ENV` | oui | `production` |
| `NEXT_PUBLIC_KORYMB_API_URL` | oui | URL publique du backend (ex. `https://api-korymb.eludein.art`) |
| `KORYMB_API_URL` | oui | Même URL, côté serveur (routes `/api/auth/*`, proxy) |
| `KORYMB_AGENT_SECRET` | oui | Secret partagé avec le backend — **jamais** en `NEXT_PUBLIC_*` |

Référence : `.env.coolify.example`.

**Healthcheck conteneur** : `GET /` (page d'accueil publique — ne dépend pas d'une session).

**Auth côté Next** : le middleware redirige vers `/login` sans cookie JWT. Les routes publiques sont `/`, `/login`, `/register`, `/api/auth/*`.

## 2) Backend Service (`backend/Dockerfile`)

Variables Coolify essentielles :

| Variable | Obligatoire | Description |
|---|---|---|
| `ENV` | oui | `production` |
| `UVICORN_PORT` | non | Alias local dev (`8020`). **En Coolify, c'est `PORT` (souvent `3000`) qui compte** — uvicorn écoute `${PORT}`. |
| `AGENT_API_SECRET` | oui | Doit être **identique** à `KORYMB_AGENT_SECRET` (frontend) |
| `JWT_SECRET` | fortement recommandé | Clé HMAC ≥ 32 caractères (sessions utilisateurs). Si vide, repli sur `AGENT_API_SECRET`. |
| `JWT_EXPIRE_HOURS` | non | Durée session JWT (défaut `168` = 7 jours) |
| `KORYMB_DB_ENGINE` | oui en prod | `mariadb` |
| `KORYMB_DB_HOST` / `PORT` / `USER` / `PASSWORD` / `NAME` | oui | Connexion MariaDB Coolify ou VPS |
| `KORYMB_BOOTSTRAP_ADMIN_EMAIL` | 1er déploiement | Compte admin initial (espace legacy / données existantes) |
| `KORYMB_BOOTSTRAP_ADMIN_PASSWORD` | 1er déploiement | Mot de passe bootstrap (≥ 8 caractères) |
| `KORYMB_BOOTSTRAP_ADMIN_DISPLAY_NAME` | non | Nom affiché |
| `KORYMB_BOOTSTRAP_WORKSPACE_NAME` | non | Nom de l'espace legacy |
| `KORYMB_CORS_ORIGINS` | si domaine custom | Origines CORS supplémentaires, séparées par des virgules |
| Clés LLM | oui | `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, etc. selon `LLM_PROVIDER` |

**Healthcheck conteneur** : `GET /health/live` sur le port **`PORT`** (3000 par défaut dans l'image Docker).

> **Important** : ne forcez pas `UVICORN_PORT=8020` en prod Coolify sauf si le port exposé du service est aussi 8020. Un décalage port proxy / uvicorn provoque des **502 Bad Gateway**.

**Au démarrage** (`init_db`) :

- Migration `workspace_id` sur les tables métier.
- Migration `enterprise_memory` : passage du schéma singleton `id=1` au PK `workspace_id` (MariaDB legacy).
- Création du compte bootstrap si les variables sont définies et l'e-mail absent.

**Nouveaux utilisateurs** : inscription via `/register` → espace Korymb dédié, isolé des données legacy.

## 3) Alignement secrets

```
KORYMB_AGENT_SECRET (frontend)  ==  AGENT_API_SECRET (backend)
```

En production, ne pas définir `NEXT_PUBLIC_KORYMB_AGENT_SECRET` : le proxy Next utilise uniquement le secret serveur.

## 4) CORS

En `ENV=production`, le backend autorise par défaut :

- `https://korymb.eludein.art`
- `http://korymb.eludein.art`
- `https://api-korymb.eludein.art`

Ajouter d'autres domaines via `KORYMB_CORS_ORIGINS` (ex. `https://app.example.com,https://www.example.com`).

## 5) Post-Deploy Smoke Test

```bash
node tools/smoke-post-deploy.mjs --app-url "https://korymb.eludein.art" --backend-url "https://api-korymb.eludein.art"
```

Vérifications manuelles recommandées :

1. `GET /health` et `GET /health/database` sur le backend.
2. Page d'accueil `/` (frontend).
3. `POST /auth/login` avec le compte bootstrap.
4. Inscription d'un compte test → `/briefing` avec 0 mission.
5. Compte bootstrap → missions legacy visibles.

Option proxy admin (secret agent) :

```bash
node tools/smoke-post-deploy.mjs --app-url "https://korymb.eludein.art" --backend-url "https://api-korymb.eludein.art" --check-admin-proxy
```

## 6) Checklist premier déploiement SaaS

- [ ] `JWT_SECRET` généré (32+ caractères aléatoires)
- [ ] `KORYMB_BOOTSTRAP_ADMIN_*` renseigné pour l'admin legacy
- [ ] MariaDB accessible depuis le conteneur backend
- [ ] URLs frontend/backend cohérentes dans les deux services
- [ ] `ENV=production` sur les deux services
- [ ] Retirer `KORYMB_BOOTSTRAP_ADMIN_PASSWORD` après création du compte si politique de sécurité stricte (le compte reste en base)

## 7) Dépannage — échec build Nixpacks (exit 255)

Symptômes dans les logs Coolify :

- `Génération de la configuration nixpacks`
- `nix-env -if .nixpacks/nixpkgs-...` puis échec / code 255
- `Type d'application trouvé : nœud`

**Cause** : le service frontend est configuré en **Nixpacks** au lieu du **Dockerfile** du projet. Nixpacks installe Node via Nix (téléchargement lourd de nixpkgs) ; sur un VPS modeste, cette étape échoue souvent (mémoire, réseau, timeout).

**Correction** (frontend `korymb.eludein.art`) :

1. Coolify → application frontend → **Configuration** → **General**
2. **Build Pack** : passer de `Nixpacks` à **`Dockerfile`**
3. **Dockerfile location** : `/Dockerfile` (racine du dépôt)
4. **Base directory** : `/` (racine)
5. **Build argument** (si proposé) : `NEXT_PUBLIC_KORYMB_API_URL=https://api-korymb.eludein.art`
6. Variables runtime : `NODE_ENV=production`, `PORT=3000`, etc. (voir §1)
7. Redéployer

Si Coolify refuse de sauvegarder après changement de build pack (bug connu v4) : recréer l’application en choisissant **Dockerfile** dès la création, puis réaffecter le domaine et les variables d’environnement.

Le backend (`api-korymb.eludein.art`) utilise **`backend/Dockerfile`** avec le build pack Dockerfile et le base directory `/backend` (ou contexte `backend/` selon votre config).

**Vérification post-fix** : les logs de build doivent afficher `FROM node:20-alpine`, pas `nixpacks` ni `nix-env`.

## 8) Dépannage — échec build Next.js (module not found / next/font)

Symptômes :

- `Failed to compile` / `Module not found` sur `@/lib/...` ou `app/layout.tsx` + `next/font`
- Build Dockerfile avec `node:20-alpine` mais échec à `RUN npm run build`

**Causes fréquentes** :

1. **`NODE_ENV=production` avant `npm ci`** — omet tailwind/postcss/typescript (devDependencies). Le Dockerfile du repo installe d’abord les deps, puis définit `NODE_ENV=production` avant le build.
2. **Build pack encore Nixpacks** — `next` introuvable (`suivant: not found` en logs FR) car `npm --prefix admin ci` n’est pas exécuté.
3. **`KORYMB_AGENT_SECRET` en build ARG** — à garder en variable **runtime** uniquement (pas en argument de build Docker).
4. **Polices Google** — `next/font/google` peut échouer sans accès réseau au build ; le layout utilise des polices système.

**Build arguments Coolify (frontend)** : uniquement `NEXT_PUBLIC_KORYMB_API_URL` si nécessaire.
