#!/usr/bin/env bash
# Client HTTP Korymb (agent secret) — health, bus, admin lecture.
# Usage (Cloud Agent Linux / local) :
#   ./scripts/korymb-api.sh GET /health
#   ./scripts/korymb-api.sh GET '/agent-bus/messages?to=cursor&status=open'
#   ./scripts/korymb-api.sh POST /agent-bus/messages '{"from":"cursor","to":"grokbot","topic":"cursor-remind","body":"Rappel"}'
#   ./scripts/korymb-api.sh POST /agent-bus/messages/bus-xxx/ack
#   ./scripts/korymb-api.sh POST /agent-bus/messages/bus-xxx/done '{"comment":"…"}'
# Secret : AGENT_API_SECRET ou KORYMB_AGENT_SECRET (env) — jamais en dur.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

read_dotenv() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *"="* ]] && continue
    local k="${line%%=*}"
    local v="${line#*=}"
    k="$(echo "$k" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [[ "$k" == "$key" ]]; then
      v="$(echo "$v" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^["'\'']//;s/["'\'']$//')"
      echo "$v"
      return 0
    fi
  done < "$file"
}

SECRET="${KORYMB_AGENT_SECRET:-${AGENT_API_SECRET:-}}"
if [[ -z "$SECRET" ]]; then
  SECRET="$(read_dotenv "$ROOT/backend/.env.local" AGENT_API_SECRET || true)"
fi
if [[ -z "$SECRET" ]]; then
  SECRET="$(read_dotenv "$ROOT/backend/.env" AGENT_API_SECRET || true)"
fi
if [[ -z "$SECRET" ]]; then
  SECRET="$(read_dotenv "$ROOT/.env" AGENT_API_SECRET || true)"
fi
if [[ -z "$SECRET" ]]; then
  SECRET="$(read_dotenv "$ROOT/.env" KORYMB_AGENT_SECRET || true)"
fi
if [[ -z "$SECRET" && -f /opt/data/.env ]]; then
  # Hermes fallback (optional)
  # shellcheck disable=SC1091
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(KORYMB_AGENT_SECRET|AGENT_API_SECRET)=' /opt/data/.env | sed 's/\r$//' || true)
  set +a
  SECRET="${KORYMB_AGENT_SECRET:-${AGENT_API_SECRET:-}}"
fi

BASE="${KORYMB_API_URL:-https://api-korymb.eludein.art}"

if [[ -z "$SECRET" ]]; then
  echo "Secret manquant : KORYMB_AGENT_SECRET ou AGENT_API_SECRET (env)." >&2
  exit 1
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 METHOD PATH [JSON_BODY]" >&2
  exit 1
fi

METHOD="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
PATH_PART="$2"
BODY="${3:-}"

case "$METHOD" in
  GET|HEAD|POST|PATCH|DELETE) ;;
  *)
    echo "Erreur: méthode $METHOD non supportée." >&2
    exit 1
    ;;
esac

[[ "$PATH_PART" == /* ]] || PATH_PART="/$PATH_PART"
URL="${BASE%/}${PATH_PART}"

echo "$METHOD $PATH_PART" >&2

CURL_ARGS=(-sS -X "$METHOD" -H "X-Agent-Secret: $SECRET" -H "Accept: application/json")
if [[ -n "$BODY" && "$METHOD" != "GET" && "$METHOD" != "HEAD" ]]; then
  CURL_ARGS+=(-H "Content-Type: application/json; charset=utf-8" -d "$BODY")
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
HTTP="$(curl "${CURL_ARGS[@]}" -o "$TMP" -w '%{http_code}' "$URL")"

if [[ "$HTTP" -ge 400 ]]; then
  echo "HTTP $HTTP" >&2
  cat "$TMP" >&2 || true
  exit 1
fi

if [[ -s "$TMP" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool < "$TMP" 2>/dev/null || cat "$TMP"
  else
    cat "$TMP"
  fi
else
  echo "(empty body)"
fi
