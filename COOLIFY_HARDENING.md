# Coolify Production Hardening

## 1) Frontend Service (this repository)

Use these environment variables in Coolify (frontend service):

- `PORT=3000`
- `NODE_ENV=production`
- `NEXT_PUBLIC_KORYMB_API_URL=https://api-korymb.example.com`
- `NEXT_PUBLIC_KORYMB_AGENT_SECRET=<shared-secret>`
- `KORYMB_API_URL=https://api-korymb.example.com`
- `KORYMB_AGENT_SECRET=<shared-secret>`

Reference template: `.env.coolify.example`.

## 2) Backend Service

Backend keeps its own `backend/.env` contract, especially:

- `AGENT_API_SECRET=<shared-secret>`
- provider keys (`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`)
- `UVICORN_PORT=8020` (or your production port)

`KORYMB_AGENT_SECRET` (frontend service) must match `AGENT_API_SECRET` (backend service).

## 3) Container Healthcheck

The Docker image now includes:

- `HEALTHCHECK` probing `http://127.0.0.1:${PORT}/dashboard`

This gives Coolify a clear container-ready signal.

## 4) Post-Deploy Smoke Test

Run after each deploy:

```bash
node tools/smoke-post-deploy.mjs --app-url "https://front-korymb.example.com" --backend-url "https://api-korymb.example.com"
```

Optional strict check of secured proxy route:

```bash
node tools/smoke-post-deploy.mjs --app-url "https://front-korymb.example.com" --backend-url "https://api-korymb.example.com" --check-admin-proxy
```

The script validates:

- main Next routes respond (`/dashboard`, `/configuration`, `/administration`, `/missions`, `/chat`, `/historique`),
- backend health endpoint responds (`/health`),
- optional admin proxy (`/api/korymb-admin`) returns expected config shape.
