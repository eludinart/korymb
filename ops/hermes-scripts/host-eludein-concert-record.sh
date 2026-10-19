#!/usr/bin/env bash
# Wrapper hôte VPS → script dans le conteneur Hermes.
set -euo pipefail
CONTAINER="${HERMES_AGENT_CONTAINER:-hermes-agent-aoxw-hermes-agent-1}"
exec docker exec "$CONTAINER" /opt/data/scripts/eludein-concert-record.sh "$@"
