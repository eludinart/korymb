#!/usr/bin/env bash
# Point d'entrée unique SQL lecture seule — route vers Korymb ou Fleur.
# Usage :
#   eludein-sql.sh korymb "SELECT COUNT(*) AS n FROM jobs LIMIT 1"
#   eludein-sql.sh fleur  "SELECT COUNT(*) AS n FROM wp_users LIMIT 1"
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 korymb|fleur \"SQL...\"" >&2
  exit 1
fi

APP="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
SQL="$2"

case "$APP" in
  korymb)
    exec /opt/data/scripts/korymb-sql.sh "$SQL"
    ;;
  fleur|fleur-damours|fleur_damours)
    exec /opt/data/scripts/fleur-sql.sh "$SQL"
    ;;
  *)
    echo "Application inconnue: $1 (attendu: korymb ou fleur)" >&2
    exit 1
    ;;
esac
