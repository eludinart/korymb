# Coolify Production Hardening

Guide de déploiement **deux services** (frontend Next.js + backend FastAPI) avec auth utilisateurs multi-tenant.

## 1) Frontend Service (racine du repo — `Dockerfile`)

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
| `UVICORN_PORT` | oui | `8020` (aligné sur le port exposé Coolify) |
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

**Healthcheck conteneur** : `GET /health/live` sur `UVICORN_PORT` (8020 par défaut).

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
