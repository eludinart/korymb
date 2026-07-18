#!/usr/bin/env bash
# Alertes proactives Élude In Art — cron Hermes.
# Envoie Telegram uniquement si au moins une alerte détectée.
# Usage : /opt/data/scripts/eludein-alerts.sh [--force-report]
set -euo pipefail

FORCE="${1:-}"
SCRIPTS="/opt/data/scripts"
ALERTS=()

add_alert() { ALERTS+=("$1"); }

# --- VPS / Hermes ---
if ! curl -sf -o /dev/null --max-time 15 https://hermes.eludein.art/; then
  add_alert "Hermes HTTPS injoignable (hermes.eludein.art)"
fi

if ! curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3001/health; then
  add_alert "WebUI Hermes unhealthy (127.0.0.1:3001)"
fi

WEBUI_HTTPS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://hermeswebui.eludein.art/health || echo 000)"
if [[ "$WEBUI_HTTPS" != "200" ]]; then
  add_alert "WebUI HTTPS hermeswebui.eludein.art HTTP $WEBUI_HTTPS"
fi

HERMES_DOWN="$(cd /docker/hermes-agent-aoxw 2>/dev/null && docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | grep -v 'Up' | grep -v '^$' || true)"
if [[ -n "$HERMES_DOWN" ]]; then
  add_alert "Conteneur Hermes down: $(echo "$HERMES_DOWN" | tr '\n' '; ')"
fi

# --- Korymb API ---
KORYMB_HTTP="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://api-korymb.eludein.art/health || echo 000)"
if [[ "$KORYMB_HTTP" != "200" ]]; then
  add_alert "Korymb API health HTTP $KORYMB_HTTP"
fi

# --- DB ---
if ! "$SCRIPTS/eludein-db-check.sh" >/tmp/eludein-db-check.out 2>&1; then
  add_alert "DB check FAIL — voir eludein-db-check.sh"
fi

# --- HITL bloqué >48h ---
HITL_STALE="$("$SCRIPTS/korymb-sql.sh" "
SELECT COUNT(*) FROM jobs
WHERE workspace_id='ws-default-legacy'
  AND status IN ('awaiting_hitl','hitl_pending','paused_hitl')
  AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 48 HOUR)
LIMIT 1
" 2>/dev/null | tail -1 || echo 0)"
if [[ "${HITL_STALE:-0}" =~ ^[0-9]+$ ]] && [[ "$HITL_STALE" -gt 0 ]]; then
  add_alert "$HITL_STALE mission(s) HITL bloquée(s) >48h — https://korymb.eludein.art/inbox"
fi

# --- Coût LLM 24h (seuil 5 USD) ---
COST_24H="$("$SCRIPTS/korymb-sql.sh" "
SELECT ROUND(COALESCE(SUM(cost_usd),0),2) FROM llm_usage_events
WHERE workspace_id='ws-default-legacy'
  AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
LIMIT 1
" 2>/dev/null | tail -1 || echo 0)"
if python3 - "$COST_24H" <<'PY'
import sys
try:
    v = float(sys.argv[1])
except ValueError:
    sys.exit(0)
sys.exit(0 if v <= 5.0 else 1)
PY
then
  :
else
  add_alert "Coût LLM 24h élevé: \$$COST_24H USD (seuil 5)"
fi

# --- Logs gateway ERROR (1h) ---
LOG_ERRORS="$(docker logs hermes-agent-aoxw-hermes-agent-1 --since 1h 2>&1 | grep -ciE 'ERROR|Traceback' || true)"
if [[ "${LOG_ERRORS:-0}" -gt 10 ]]; then
  add_alert "$LOG_ERRORS erreurs dans logs agent (1h) — skill eludein-log-watcher"
fi

# --- Livraison ---
if [[ ${#ALERTS[@]} -eq 0 ]]; then
  if [[ "$FORCE" == "--force-report" ]]; then
    "$SCRIPTS/eludein-telegram-send.sh" "✅ Élude In Art — aucune alerte ($(date -u +%H:%MZ))."
  else
    echo "OK — aucune alerte."
  fi
  exit 0
fi

MSG="⚠️ *Alertes Élude In Art* ($(date -u +%Y-%m-%dT%H:%MZ))
"
for a in "${ALERTS[@]}"; do
  MSG+="
• $a"
done

"$SCRIPTS/eludein-telegram-send.sh" "$MSG" --parse-mode Markdown
echo "Alertes envoyées: ${#ALERTS[@]}"
