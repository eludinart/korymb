#!/usr/bin/env bash
# Requêtes SQL lecture seule sur la base Korymb (MariaDB Coolify).
# Usage : korymb-sql.sh "SELECT ..."
# Variables : KORYMB_DB_* dans /opt/data/.env (Hermes) ou l'environnement.
set -euo pipefail

ENV_FILE="${HERMES_ENV_FILE:-/opt/data/.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^KORYMB_DB_' "$ENV_FILE" | sed 's/\r$//')
  set +a
fi

HOST="${KORYMB_DB_HOST:-juehpsnqkm60d2o6dhs38c5t}"
PORT="${KORYMB_DB_PORT:-3306}"
DB="${KORYMB_DB_NAME:-default}"
USER="${KORYMB_DB_USER:-hermes_readonly}"
PASS="${KORYMB_DB_PASSWORD:-}"

if [[ -z "$PASS" ]]; then
  echo "Erreur: KORYMB_DB_PASSWORD manquant ($ENV_FILE)." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"SELECT ...\"" >&2
  exit 1
fi

SQL="$(echo "$1" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/;*$//')"
SQL_UPPER="$(echo "$SQL" | tr '[:lower:]' '[:upper:]')"

if [[ ! "$SQL_UPPER" =~ ^(SELECT|SHOW|DESCRIBE|DESC)[[:space:]] ]]; then
  echo "Erreur: seules SELECT, SHOW et DESCRIBE sont autorisees." >&2
  exit 1
fi

if echo "$SQL" | grep -qiE '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b'; then
  echo "Erreur: mot-clé SQL interdit détecté." >&2
  exit 1
fi

if echo "$SQL" | grep -q ';'; then
  echo "Erreur: une seule requête SELECT sans point-virgule interne." >&2
  exit 1
fi

if [[ "$SQL_UPPER" =~ ^SELECT[[:space:]] ]] && ! echo "$SQL_UPPER" | grep -qE '\bLIMIT[[:space:]]+[0-9]'; then
  SQL="$SQL LIMIT 200"
fi

MARIADB_CONTAINER="${KORYMB_DB_CONTAINER:-juehpsnqkm60d2o6dhs38c5t}"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$MARIADB_CONTAINER"; then
  exec docker exec "$MARIADB_CONTAINER" mariadb \
    -h 127.0.0.1 -P 3306 -u"$USER" -p"$PASS" "$DB" \
    --batch --raw --default-character-set=utf8mb4 \
    -e "$SQL"
fi

if command -v mariadb >/dev/null 2>&1; then
  exec mariadb -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" \
    --batch --raw --default-character-set=utf8mb4 \
    -e "$SQL"
fi

echo "Erreur: ni docker ($MARIADB_CONTAINER) ni client mariadb disponible." >&2
exit 1
