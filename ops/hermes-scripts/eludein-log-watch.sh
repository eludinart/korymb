#!/usr/bin/env bash
# Surveillance logs Hermes — alerte si seuil ERROR dépassé.
# Usage : /opt/data/scripts/eludein-log-watch.sh
set -euo pipefail

SCRIPTS="/opt/data/scripts"
CONTAINER="${HERMES_AGENT_CONTAINER:-hermes-agent-aoxw-hermes-agent-1}"
SINCE="${LOG_WATCH_SINCE:-1h}"
THRESHOLD="${LOG_WATCH_ERROR_THRESHOLD:-15}"

ERRORS="$(docker logs "$CONTAINER" --since "$SINCE" 2>&1 | grep -ciE 'ERROR|Traceback|401 Unauthorized' || true)"
AUTH401="$(docker logs "$CONTAINER" --since "$SINCE" 2>&1 | grep -c '401 Unauthorized' || true)"

if [[ "${ERRORS:-0}" -lt "$THRESHOLD" && "${AUTH401:-0}" -lt 5 ]]; then
  echo "Logs OK — $ERRORS lignes suspectes ($SINCE), seuil $THRESHOLD"
  exit 0
fi

MSG="📋 *Log watch Hermes* ($(date -u +%Y-%m-%dT%H:%MZ))
• Fenêtre: $SINCE
• Lignes ERROR/Traceback/401: $ERRORS (401: $AUTH401)
• Conteneur: $CONTAINER
→ skill \`eludein-log-watcher\` pour analyse"

"$SCRIPTS/eludein-telegram-send.sh" "$MSG" --parse-mode Markdown
