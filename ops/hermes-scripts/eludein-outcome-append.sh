#!/usr/bin/env bash
# Append un outcome dans memories/decisions-eric.md (section Outcomes).
# Usage: eludein-outcome-append.sh "titre" "corps markdown"
set -euo pipefail
TITLE="${1:-}"
BODY="${2:-}"
[[ -n "$TITLE" && -n "$BODY" ]] || { echo "Usage: $0 \"titre\" \"corps\"" >&2; exit 1; }
MEM="${HERMES_DATA:-/opt/data}/memories/decisions-eric.md"
# Prefer volume path if /opt/data is host without memories write
if [[ ! -w "$(dirname "$MEM")" ]]; then
  MEM=/docker/hermes-agent-aoxw/data/memories/decisions-eric.md
fi
TS=$(date -u +%Y-%m-%dT%H:%MZ)
touch "$MEM"
if ! grep -q '^## Outcomes' "$MEM" 2>/dev/null; then
  printf '\n\n## Outcomes\n' >> "$MEM"
fi
{
  echo ""
  echo "### $TS — $TITLE"
  echo "$BODY"
} >> "$MEM"
echo "Appended outcome -> $MEM"
