#!/usr/bin/env bash
set -euo pipefail
CONTAINER="${HERMES_AGENT_CONTAINER:-hermes-agent-aoxw-hermes-agent-1}"
# run on host against volume for reliability
MEM=/docker/hermes-agent-aoxw/data/memories/decisions-eric.md
TITLE="${1:-}"; BODY="${2:-}"
[[ -n "$TITLE" && -n "$BODY" ]] || { echo "Usage: $0 titre corps" >&2; exit 1; }
TS=$(date -u +%Y-%m-%dT%H:%MZ)
touch "$MEM"
grep -q '^## Outcomes' "$MEM" 2>/dev/null || printf '\n\n## Outcomes\n' >> "$MEM"
printf '\n### %s — %s\n%s\n' "$TS" "$TITLE" "$BODY" >> "$MEM"
echo "OK $MEM"
