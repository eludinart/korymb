#!/usr/bin/env bash
# Pont API Korymb — actions métier sans SQL.
# Usage :
#   korymb-api.sh GET /admin/briefing?period=today
#   korymb-api.sh GET /admin/inbox
#   korymb-api.sh GET /health
#   korymb-api.sh PATCH /admin/notifications/{id}/read
# Secret : KORYMB_AGENT_SECRET ou AGENT_API_SECRET dans /opt/data/.env
set -euo pipefail

ENV_FILE="${HERMES_ENV_FILE:-/opt/data/.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^(KORYMB_AGENT_SECRET|AGENT_API_SECRET|KORYMB_API_URL)=' "$ENV_FILE" | sed 's/\r$//')
  set +a
fi

SECRET="${KORYMB_AGENT_SECRET:-${AGENT_API_SECRET:-}}"
BASE="${KORYMB_API_URL:-https://api-korymb.eludein.art}"

if [[ -z "$SECRET" ]]; then
  echo "Erreur: KORYMB_AGENT_SECRET manquant dans $ENV_FILE." >&2
  echo "Ajouter la même valeur que AGENT_API_SECRET (backend Korymb)." >&2
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 METHOD PATH [JSON_BODY]" >&2
  echo "Exemples:" >&2
  echo "  $0 GET /health" >&2
  echo "  $0 GET '/admin/briefing?period=today'" >&2
  echo "  $0 GET /admin/inbox" >&2
  exit 1
fi

METHOD="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
PATH_PART="$2"
BODY="${3:-}"

case "$METHOD" in
  GET|HEAD) ;;
  PATCH|POST|DELETE) ;;
  *)
    echo "Erreur: méthode $METHOD non supportée." >&2
    exit 1
    ;;
esac

# Interdire écritures dangereuses
if [[ "$METHOD" != "GET" && "$METHOD" != "HEAD" ]]; then
  case "$PATH_PART" in
    /admin/notifications/*/read|/admin/notifications/mark-all-read|/admin/inbox/dismiss)
      ;;
    *)
      echo "Erreur: écriture non autorisée sur $PATH_PART (whitelist notifications/inbox dismiss)." >&2
      exit 1
      ;;
  esac
fi

URL="${BASE%/}${PATH_PART}"
CURL_ARGS=(-sS -X "$METHOD" -H "X-Agent-Secret: $SECRET" -H "Accept: application/json")

if [[ -n "$BODY" ]]; then
  CURL_ARGS+=(-H "Content-Type: application/json" -d "$BODY")
fi

HTTP="$(curl "${CURL_ARGS[@]}" -o /tmp/korymb-api-response.json -w '%{http_code}' "$URL")"
echo "HTTP $HTTP — $METHOD $PATH_PART"

if [[ "$HTTP" -ge 400 ]]; then
  cat /tmp/korymb-api-response.json >&2
  exit 1
fi

if [[ -s /tmp/korymb-api-response.json ]]; then
  python3 -m json.tool /tmp/korymb-api-response.json 2>/dev/null || cat /tmp/korymb-api-response.json
else
  echo "(empty body)"
fi
