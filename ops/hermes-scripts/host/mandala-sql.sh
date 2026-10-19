#!/usr/bin/env bash
set -euo pipefail
CONTAINER="${HERMES_AGENT_CONTAINER:-hermes-agent-aoxw-hermes-agent-1}"
QUERY="$*"
exec docker exec "$CONTAINER" /opt/data/scripts/mandala-sql.sh "$QUERY"
