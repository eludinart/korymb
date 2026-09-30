#!/usr/bin/env bash
# Journal concert côté Hermes/VPS : append mémoire + option session Korymb + Telegram.
# Usage: eludein-concert-record.sh "titre" "corps" [--korymb] [--telegram]
set -euo pipefail
TITLE="${1:-}"
BODY="${2:-}"
shift 2 || true
DO_KORYMB=0
DO_TG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --korymb) DO_KORYMB=1; shift ;;
    --telegram) DO_TG=1; shift ;;
    *) shift ;;
  esac
done
[[ -n "$TITLE" && -n "$BODY" ]] || { echo "Usage: $0 titre corps [--korymb] [--telegram]" >&2; exit 1; }

APPEND=/opt/data/scripts/eludein-outcome-append.sh
[ -x "$APPEND" ] || APPEND=/docker/hermes-agent-aoxw/data/scripts/eludein-outcome-append.sh
"$APPEND" "$TITLE" "$BODY"

if [ "$DO_KORYMB" = 1 ]; then
  OPEN=/opt/data/scripts/eludein-korymb-open-session.sh
  [ -x "$OPEN" ] || OPEN=/docker/hermes-agent-aoxw/data/scripts/eludein-korymb-open-session.sh
  "$OPEN" "Concert — $TITLE" "[concert/hermes]

$BODY"
fi

if [ "$DO_TG" = 1 ]; then
  TG=/opt/data/scripts/eludein-telegram-send.sh
  [ -x "$TG" ] || TG=/docker/hermes-agent-aoxw/data/scripts/eludein-telegram-send.sh
  if [ -x "$TG" ]; then
    "$TG" "Concert: $TITLE"
  fi
fi

echo "CONCERT_RECORD_OK title=$TITLE"
