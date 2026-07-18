#!/usr/bin/env bash
# Smoke test post-déploiement — alerte Telegram si échec.
# Usage : /opt/data/scripts/eludein-post-deploy-smoke.sh
set -euo pipefail

SCRIPTS="/opt/data/scripts"
FAILS=()

check() {
  local name="$1" url="$2" expect="${3:-200}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo 000)"
  if [[ "$code" != "$expect" && "$expect" != *"$code"* ]]; then
    FAILS+=("$name HTTP $code (attendu $expect)")
  fi
}

check "Korymb app" "https://korymb.eludein.art/" "200|302"
check "Korymb API" "https://api-korymb.eludein.art/health" "200"
check "Hermes" "https://hermes.eludein.art/" "200|302"
check "Fleur app" "https://app-fleurdamours.eludein.art/" "200|302|307"

if ! curl -sf --max-time 5 http://127.0.0.1:3001/health >/dev/null; then
  FAILS+=("WebUI Hermes unhealthy (localhost:3001)")
fi

WEBUI_HTTPS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://hermeswebui.eludein.art/health || echo 000)"
if [[ "$WEBUI_HTTPS" != "200" ]]; then
  FAILS+=("WebUI HTTPS hermeswebui.eludein.art HTTP $WEBUI_HTTPS")
fi

if ! "$SCRIPTS/eludein-db-check.sh" >/dev/null 2>&1; then
  FAILS+=("eludein-db-check FAIL")
fi

if [[ ${#FAILS[@]} -eq 0 ]]; then
  echo "Smoke OK — $(date -u +%Y-%m-%dT%H:%MZ)"
  exit 0
fi

MSG="🔴 *Smoke post-deploy FAIL* ($(date -u +%Y-%m-%dT%H:%MZ))
"
for f in "${FAILS[@]}"; do
  MSG+="
• $f"
done

"$SCRIPTS/eludein-telegram-send.sh" "$MSG" --parse-mode Markdown
echo "Smoke FAIL: ${#FAILS[@]} problème(s)"
exit 1
