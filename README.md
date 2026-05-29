# Korymb — Development Platform

This repository contains:

- `admin/`: unified Next.js frontend (metier, chat, historique, configuration, administration).
- `backend/`: FastAPI orchestration backend (LLM providers, jobs, tools, persistence).

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

- `backend/.env` -> `AGENT_API_SECRET=...`
- **`admin/.env.local`** -> `KORYMB_AGENT_SECRET=...` (obligatoire pour Next : missions, configuration LLM)
- `admin/.env.local` -> `NEXT_PUBLIC_KORYMB_AGENT_SECRET=...` (meme valeur)

#### Dev branché sur MariaDB du VPS

Le port 3306 n'est en général pas ouvert sur Internet. Utiliser un tunnel SSH :

```powershell
# Terminal 1 — tunnel (laisser ouvert ; adapter KORYMB_VPS_SSH si besoin)
$env:KORYMB_VPS_SSH = "root@187.124.42.135"
.\scripts\mariadb-vps-tunnel.ps1

# backend/.env : identifiants MariaDB (KORYMB_DB_USER, KORYMB_DB_PASSWORD, KORYMB_DB_NAME)
copy backend\.env.local.example backend\.env.local
# .env.local force KORYMB_DB_ENGINE=mariadb, host 127.0.0.1, port 3307
```

Vérifier dans l'UI (bandeau runtime) ou `GET http://127.0.0.1:8020/health` : `database.engine` = `mariadb`, `database.connected` = `true`.

### 3) Run app

```powershell
.\start-dev-cursor.ps1
```

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
- `npm run smoke:deploy -- --app-url <front-url> --backend-url <api-url>`: post-deploy smoke test.

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
