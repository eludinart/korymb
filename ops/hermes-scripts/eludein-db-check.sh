#!/usr/bin/env bash
# Vérification des accès lecture seule Korymb + Fleur d'ÅmÔurs.
# Usage : /opt/data/scripts/eludein-db-check.sh
# Exit 0 = tout OK. Exit 1 = échec (ne pas improviser avec root/python).
set -euo pipefail

KORYMB_SCRIPT="/opt/data/scripts/korymb-sql.sh"
FLEUR_SCRIPT="/opt/data/scripts/fleur-sql.sh"

fail() {
  echo "STATUS: FAIL — $1" >&2
  exit 1
}

[[ -x "$KORYMB_SCRIPT" ]] || fail "korymb-sql.sh introuvable"
[[ -x "$FLEUR_SCRIPT" ]] || fail "fleur-sql.sh introuvable"
[[ -f /opt/data/.env ]] || fail "/opt/data/.env introuvable"

echo "=== Eludein DB Check ==="
echo "Conteneur attendu: juehpsnqkm60d2o6dhs38c5t (PAS p11nw75ijqbg4lfzmwbw2m3m)"
echo ""

korymb_ws="$("$KORYMB_SCRIPT" "SELECT COUNT(*) AS n FROM korymb_workspaces LIMIT 1" | tail -1)" || fail "Korymb workspaces"
korymb_jobs="$("$KORYMB_SCRIPT" "SELECT COUNT(*) AS n FROM jobs LIMIT 1" | tail -1)" || fail "Korymb jobs"
fleur_users="$("$FLEUR_SCRIPT" "SELECT COUNT(*) AS n FROM wp_users LIMIT 1" | tail -1)" || fail "Fleur users"
fleur_tables="$("$FLEUR_SCRIPT" "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='default' AND table_name LIKE 'wp_fleur_%'" | tail -1)" || fail "Fleur tables"

echo "Korymb workspaces : $korymb_ws"
echo "Korymb jobs         : $korymb_jobs"
echo "Fleur users         : $fleur_users"
echo "Fleur tables        : $fleur_tables"
echo ""
echo "STATUS: OK — Utilise korymb-sql.sh et fleur-sql.sh uniquement. Jamais root, jamais Python pour SQL."
