#!/usr/bin/env bash
# Requêtes SQL lecture seule sur la base de l'app Fleur d'ÅmÔurs (MariaDB Coolify).
# Usage : fleur-sql.sh "SELECT ..." | fleur-sql.sh "SHOW TABLES LIKE 'wp_fleur_%'"
# Variables : FLEUR_DB_* dans /opt/data/.env (Hermes) ou l'environnement.
set -euo pipefail

ENV_FILE="${HERMES_ENV_FILE:-/opt/data/.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^FLEUR_DB_' "$ENV_FILE" | sed 's/\r$//')
  set +a
fi

HOST="${FLEUR_DB_HOST:-juehpsnqkm60d2o6dhs38c5t}"
PORT="${FLEUR_DB_PORT:-3306}"
DB="${FLEUR_DB_NAME:-default}"
USER="${FLEUR_DB_USER:-hermes_fleur_readonly}"
PASS="${FLEUR_DB_PASSWORD:-}"

if [[ -z "$PASS" ]]; then
  echo "Erreur: FLEUR_DB_PASSWORD manquant ($ENV_FILE)." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"SELECT ...\" | \"SHOW ...\" | \"DESCRIBE table\"" >&2
  exit 1
fi

SQL="$(echo "$1" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/;*$//')"
SQL_UPPER="$(echo "$SQL" | tr '[:lower:]' '[:upper:]')"

if [[ ! "$SQL_UPPER" =~ ^(SELECT|SHOW|DESCRIBE|DESC)[[:space:]] ]]; then
  echo "Erreur: seules SELECT, SHOW et DESCRIBE sont autorisees." >&2
  exit 1
fi

if echo "$SQL" | grep -qiE '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)\b'; then
  echo "Erreur: mot-cle SQL interdit detecte." >&2
  exit 1
fi

if echo "$SQL" | grep -q ';'; then
  echo "Erreur: une seule requete sans point-virgule interne." >&2
  exit 1
fi

if [[ "$SQL_UPPER" =~ ^SELECT[[:space:]] ]] && ! echo "$SQL_UPPER" | grep -qE '\bLIMIT[[:space:]]+[0-9]'; then
  SQL="$SQL LIMIT 200"
fi

MARIADB_CONTAINER="${FLEUR_DB_CONTAINER:-juehpsnqkm60d2o6dhs38c5t}"

_run() {
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$MARIADB_CONTAINER"; then
    docker exec "$MARIADB_CONTAINER" mariadb \
      -h 127.0.0.1 -P 3306 -u"$USER" -p"$PASS" "$DB" \
      --batch --raw --default-character-set=utf8mb4 \
      -e "$SQL"
    return
  fi
  if command -v mariadb >/dev/null 2>&1; then
    mariadb -h"$HOST" -P"$PORT" -u"$USER" -p"$PASS" "$DB" \
      --batch --raw --default-character-set=utf8mb4 \
      -e "$SQL"
    return
  fi
  echo "Erreur: ni docker ($MARIADB_CONTAINER) ni client mariadb disponible." >&2
  exit 1
}

_run
