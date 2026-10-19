#!/usr/bin/env bash
# Envoie un message Telegram via le bot Hermes.
# Usage : eludein-telegram-send.sh "texte" [--parse-mode Markdown]
set -euo pipefail

ENV_FILE="${HERMES_ENV_FILE:-/opt/data/.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^(TELEGRAM_BOT_TOKEN|TELEGRAM_HOME_CHANNEL|TELEGRAM_ALLOWED_USERS)=' "$ENV_FILE" | sed 's/\r$//')
  set +a
fi

TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_HOME_CHANNEL:-}"

if [[ -z "$CHAT" && -n "${TELEGRAM_ALLOWED_USERS:-}" ]]; then
  CHAT="$(echo "$TELEGRAM_ALLOWED_USERS" | tr ',' ' ' | awk '{print $1}')"
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"message\" [--parse-mode Markdown]" >&2
  exit 1
fi

MSG="$1"
PARSE_MODE=""
if [[ "${2:-}" == "--parse-mode" && -n "${3:-}" ]]; then
  PARSE_MODE="$3"
fi

if [[ -z "$TOKEN" || -z "$CHAT" ]]; then
  echo "Erreur: TELEGRAM_BOT_TOKEN ou chat cible manquant ($ENV_FILE)." >&2
  exit 1
fi

# Build JSON safely
if [[ -n "$PARSE_MODE" ]]; then
  BODY="$(MSG="$MSG" CHAT="$CHAT" MODE="$PARSE_MODE" python3 -c 'import json,os; print(json.dumps({"chat_id":os.environ["CHAT"],"text":os.environ["MSG"],"parse_mode":os.environ["MODE"],"disable_web_page_preview":True}))')"
else
  BODY="$(MSG="$MSG" CHAT="$CHAT" python3 -c 'import json,os; print(json.dumps({"chat_id":os.environ["CHAT"],"text":os.environ["MSG"],"disable_web_page_preview":True}))')"
fi

HTTP="$(curl -sS -o /tmp/eludein-tg-response.json -w '%{http_code}' \
  -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H 'Content-Type: application/json' \
  -d "$BODY")"

if [[ "$HTTP" != "200" ]]; then
  echo "Erreur Telegram HTTP $HTTP" >&2
  cat /tmp/eludein-tg-response.json >&2 || true
  exit 1
fi

echo "Telegram OK (HTTP $HTTP)"
