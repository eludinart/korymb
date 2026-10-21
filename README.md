# Korymb — Development Platform

This repository contains:

- `admin/`: unified Next.js frontend (metier, chat, historique, configuration, administration).
- `backend/`: FastAPI orchestration backend (LLM providers, jobs, tools, persistence).
- `wordpress/`: child theme for the public site [eludein.art](https://eludein.art) (OceanWP visual layer only — WooCommerce stays on Hostinger).

The goal of this setup is to keep development fast while reducing regressions through shared standards and automated checks.

## Quick Start

### 1) Install dependencies

```bash
npm install
npm --prefix admin install
python -m pip install -r backend/requirements.txt
```

### 2) Configure environment

```bash
copy admin\.env.local.example admin\.env.local
copy backend\.env.example backend\.env
```

Then fill required secrets and keep them aligned:

- `backend/.env` -> `AGENT_API_SECRET=...` (clients machine : Hermes, scripts — jamais dans le navigateur)
- Le cockpit Next s'authentifie par cookie httpOnly (`korymb_token`) via les routes `/api/korymb*`

#### Dev sur SQLite

Le backend local utilise `backend/data/korymb.db`. La prod Coolify reste sur MariaDB.

```powershell
copy backend\.env.local.example backend\.env.local
# .env.local : KORYMB_DB_ENGINE=sqlite
```

Pour remplir cette base avec un extrait récent de la prod (missions, contacts, devis, chat), ouvrir le tunnel le temps de la copie puis le refermer :

```powershell
.\scripts\mariadb-vps-tunnel.ps1
python backend/scripts/import_sqlite_dev_slice.py
```

Vérifier `GET http://127.0.0.1:8020/health/database` : `database.engine` = `sqlite`, `database.connected` = `true`.

### 3) Run app

```powershell
.\start-dev-cursor.ps1
```

Guide de démarrage détaillé (options, watchdog, logs, dépannage) : [docs/DEMARRAGE.md](docs/DEMARRAGE.md).

Administration VPS (Korymb prod + Hermes Agent) : [docs/ADMINISTRATION.md](docs/ADMINISTRATION.md).

Description métier complète pour Hermes : [docs/KORYMB-DESCRIPTION-HERMES.md](docs/KORYMB-DESCRIPTION-HERMES.md).

Starter packs (amorçage optionnel, produit générique) : [docs/STARTER-PACKS.md](docs/STARTER-PACKS.md).

Stop with:

```powershell
.\stop-dev-cursor.ps1
```

Manual fallback mode (without helper scripts):

```bash
python backend/main.py
npm --prefix admin run dev
```

## Quality Commands

Run these before opening a PR:

```bash
npm run check
```

Useful individual commands:

- `npm run lint`: lint unified Next.js frontend.
- `npm run build`: compile-check unified Next.js frontend.
- `npm run start`: start unified Next.js frontend.
- `npm run check:backend`: compile-check backend python files.
- `npm run verify:api`: health probe for backend endpoint.
- `npm run smoke:p0`: public HTTP check of Korymb, Fleur, Hermes, and MariaDB.
- `npm run smoke:deploy -- --app-url <front-url> --backend-url <api-url>`: post-deploy smoke test.
- `npm --prefix admin run test:e2e`: Playwright smoke (build required unless a server already listens on :3000).

## Documentation

- `ARCHITECTURE.md`: system boundaries, data flow, and runtime config model.
- `CONTRIBUTING.md`: branch/PR workflow, code expectations, and review checklist.
- `TESTING.md`: testing strategy and release gates.

## Project Rules For AI/Automation

Persistent AI rules are defined in `.cursor/rules/` and cover:

- coding and architecture guardrails,
- UX and copy consistency,
- backend safety and runtime config behavior.

These rules exist to keep implementations consistent and predictable across all contributions.
