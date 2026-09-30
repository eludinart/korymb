#!/usr/bin/env bash
# Requêtes SQL lecture seule — base Mandala (MariaDB Coolify p11nw…).
set -euo pipefail
ENV_FILE="${HERMES_ENV_FILE:-/opt/data/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source <(grep -E '^MANDALA_DB_' "$ENV_FILE" | sed 's/\r$//')
  set +a
fi
HOST="${MANDALA_DB_HOST:-p11nw75ijqbg4lfzmwbw2m3m}"
PORT="${MANDALA_DB_PORT:-3306}"
DB="${MANDALA_DB_NAME:-default}"
USER="${MANDALA_DB_USER:-hermes_mandala_readonly}"
PASS="${MANDALA_DB_PASSWORD:-}"
MARIADB_CONTAINER="${MANDALA_DB_CONTAINER:-p11nw75ijqbg4lfzmwbw2m3m}"
[[ -n "$PASS" ]] || { echo "Erreur: MANDALA_DB_PASSWORD manquant" >&2; exit 1; }
[[ $# -ge 1 ]] || { echo "Usage: $0 \"SELECT ...\"" >&2; exit 1; }
SQL="$(echo "$1" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/;*$//')"
SQL_UPPER="$(echo "$SQL" | tr '[:lower:]' '[:upper:]')"
[[ "$SQL_UPPER" =~ ^(SELECT|SHOW|DESCRIBE|DESC)[[:space:]] ]] || { echo "Erreur: SELECT/SHOW/DESCRIBE only" >&2; exit 1; }
echo "$SQL" | grep -qiE '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b' && { echo "Erreur: mot-cle interdit" >&2; exit 1; }
echo "$SQL" | grep -q ';' && { echo "Erreur: une seule requete" >&2; exit 1; }
if [[ "$SQL_UPPER" =~ ^SELECT[[:space:]] ]] && ! echo "$SQL_UPPER" | grep -qE '\bLIMIT[[:space:]]+[0-9]'; then
  SQL="$SQL LIMIT 200"
fi
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$MARIADB_CONTAINER"; then
  docker exec "$MARIADB_CONTAINER" mariadb -h127.0.0.1 -P3306 -u"$USER" -p"$PASS" "$DB" --batch --raw --default-character-set=utf8mb4 -e "$SQL"
else
  mariadb -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" --batch --raw --default-character-set=utf8mb4 -e "$SQL"
fi
