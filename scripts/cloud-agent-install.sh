#!/usr/bin/env bash
# Idempotent bootstrap for the Cursor Cloud Agent environment.
# Prepares the FastAPI backend (Python venv) and the Next.js frontend (admin/),
# and seeds dev .env files (SQLite engine, no external secrets required).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[install] Python venv + backend requirements"
if ! python3 -m venv --help >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3-venv
fi
if [ ! -x ".venv/bin/python" ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip -q
.venv/bin/python -m pip install -r backend/requirements.txt

echo "[install] Node dependencies (root + admin)"
npm ci --no-audit --no-fund
npm --prefix admin ci --no-audit --no-fund

echo "[install] Seed dev env files (idempotent, SQLite, no external secrets)"
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  cat >> backend/.env <<'ENV'

# Cloud Agent dev defaults (SQLite, local bootstrap admin).
KORYMB_BOOTSTRAP_ADMIN_EMAIL=admin@korymb.dev
KORYMB_BOOTSTRAP_ADMIN_PASSWORD=korymb-admin-2026
KORYMB_BOOTSTRAP_ADMIN_DISPLAY_NAME=Admin
KORYMB_BOOTSTRAP_WORKSPACE_NAME=Korymb Dev
JWT_SECRET=dev-jwt-secret-please-change-32chars-long-0001
ENV
fi

if [ ! -f admin/.env.local ]; then
  cat > admin/.env.local <<'ENV'
NEXT_PUBLIC_KORYMB_API_URL=http://127.0.0.1:8020
PORT=3000
NEXT_PUBLIC_KORYMB_AGENT_SECRET=korymb-secret-2026
KORYMB_AGENT_SECRET=korymb-secret-2026
ENV
fi

echo "[install] Done"
