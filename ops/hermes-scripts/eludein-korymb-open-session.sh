#!/usr/bin/env bash
# Ouvre une session de cadrage Korymb (HITL) avec un brief.
# Usage: eludein-korymb-open-session.sh "titre" "message"
set -euo pipefail
TITLE="${1:-Brief Hermes}"
MSG="${2:-}"
[[ -n "$MSG" ]] || { echo "Usage: $0 titre message" >&2; exit 1; }
SECRET=$(grep ^KORYMB_AGENT_SECRET= /opt/data/.env | cut -d= -f2-)
[[ -n "$SECRET" ]] || { echo "KORYMB_AGENT_SECRET manquant" >&2; exit 1; }
BODY=$(TITLE="$TITLE" MSG="$MSG" python3 -c 'import json,os; print(json.dumps({"agent":"coordinateur","title":os.environ["TITLE"][:255],"initial_message":os.environ["MSG"][:6000]}))')
curl -sS -X POST "https://api-korymb.eludein.art/mission-sessions" \
  -H "X-Agent-Secret: $SECRET" -H "Content-Type: application/json" -d "$BODY"
echo
