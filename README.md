# Tarot App - Development Platform

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
copy .env.example .env.local
copy backend\.env.example backend\.env
```

Then fill required secrets and keep them aligned:

- `backend/.env` -> `AGENT_API_SECRET=...`
- `.env.local` -> `KORYMB_AGENT_SECRET=...`
- `.env.local` -> `NEXT_PUBLIC_KORYMB_AGENT_SECRET=...` (same value)

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
