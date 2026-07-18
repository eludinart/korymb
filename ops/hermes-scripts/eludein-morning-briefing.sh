#!/usr/bin/env bash
# Briefing matinal Élude In Art — cron 7h Paris (5h UTC).
# Usage : /opt/data/scripts/eludein-morning-briefing.sh [--no-telegram]
set -euo pipefail

SCRIPTS="/opt/data/scripts"
NO_TG="${1:-}"
DATE="$(date -u +%Y-%m-%dT%H:%MZ)"
SECTIONS=()

append() { SECTIONS+=("$1"); echo "$1"; }

append "=== Briefing Élude In Art $DATE ==="
append ""

append "--- Santé VPS ---"
append "$(cd /docker/hermes-agent-aoxw && docker compose ps --format 'table {{.Service}}\t{{.Status}}' 2>/dev/null || echo 'compose indisponible')"
HERMES_HTTP="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://hermes.eludein.art/ || echo 000)"
append "hermes.eludein.art HTTP $HERMES_HTTP"

append ""
append "--- Bases de données ---"
append "$("$SCRIPTS/eludein-db-check.sh" 2>&1 || echo 'DB check FAIL')"

append ""
append "--- Korymb (ws-default-legacy) ---"
if [[ -f /opt/data/.env ]] && grep -qE '^KORYMB_AGENT_SECRET=' /opt/data/.env 2>/dev/null; then
  append "(API briefing)"
  append "$("$SCRIPTS/korymb-api.sh" GET '/admin/briefing?period=today' 2>&1 | head -80 || echo 'API briefing indisponible')"
else
  append "(SQL — ajouter KORYMB_AGENT_SECRET pour API briefing)"
  append "$("$SCRIPTS/korymb-sql.sh" "SELECT status, COUNT(*) n FROM jobs WHERE workspace_id='ws-default-legacy' GROUP BY status LIMIT 15" 2>&1 || true)"
  append "$("$SCRIPTS/korymb-sql.sh" "SELECT COUNT(*) AS notif_unread FROM director_notifications WHERE workspace_id='ws-default-legacy' AND read_at IS NULL LIMIT 1" 2>&1 || true)"
fi

append ""
append "--- Fleur d'ÅmÔurs ---"
append "$("$SCRIPTS/fleur-sql.sh" "SELECT COUNT(*) AS users FROM wp_users LIMIT 1" 2>&1 || true)"
append "$("$SCRIPTS/fleur-sql.sh" "SELECT COUNT(*) AS new_7d FROM wp_users WHERE user_registered >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) LIMIT 1" 2>&1 || true)"

append ""
append "=== Fin briefing ==="

if [[ "$NO_TG" == "--no-telegram" ]]; then
  exit 0
fi

# Telegram : version courte
NOTIF="$("$SCRIPTS/korymb-sql.sh" "SELECT COUNT(*) FROM director_notifications WHERE workspace_id='ws-default-legacy' AND read_at IS NULL LIMIT 1" 2>/dev/null | tail -1 || echo '?')"
OPEN="$("$SCRIPTS/korymb-sql.sh" "SELECT COUNT(*) FROM jobs WHERE workspace_id='ws-default-legacy' AND status NOT IN ('completed','cancelled') LIMIT 1" 2>/dev/null | tail -1 || echo '?')"
FLEUR7="$("$SCRIPTS/fleur-sql.sh" "SELECT COUNT(*) FROM wp_users WHERE user_registered >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) LIMIT 1" 2>/dev/null | tail -1 || echo '?')"

TG_MSG="☀️ *Briefing Élude In Art* — $DATE

• Hermes: HTTP $HERMES_HTTP
• Korymb jobs ouverts: $OPEN | notifs: $NOTIF
• Fleur users 7j: +$FLEUR7
• Inbox: https://korymb.eludein.art/inbox"

"$SCRIPTS/eludein-telegram-send.sh" "$TG_MSG" --parse-mode Markdown || echo "Telegram non envoyé (config manquante?)"
