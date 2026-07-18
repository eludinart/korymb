#!/usr/bin/env bash
# Recap soir Élude In Art — cron 19h Paris (17h UTC).
# Usage : /opt/data/scripts/eludein-evening-recap.sh
set -euo pipefail

SCRIPTS="/opt/data/scripts"
DATE="$(date -u +%Y-%m-%dT%H:%MZ)"

# Korymb jobs du jour
JOBS_TODAY="$("$SCRIPTS/korymb-sql.sh" "
SELECT status, COUNT(*) n FROM jobs
WHERE workspace_id='ws-default-legacy'
  AND DATE(updated_at)=CURDATE()
GROUP BY status
LIMIT 10
" 2>/dev/null || echo '(SQL indisponible)')"

NOTIF="$("$SCRIPTS/korymb-sql.sh" "
SELECT COUNT(*) FROM director_notifications
WHERE workspace_id='ws-default-legacy' AND read_at IS NULL
LIMIT 1
" 2>/dev/null | tail -1 || echo '?')"

COST="$("$SCRIPTS/korymb-sql.sh" "
SELECT ROUND(COALESCE(SUM(cost_usd),0),2) FROM llm_usage_events
WHERE workspace_id='ws-default-legacy' AND DATE(created_at)=CURDATE()
LIMIT 1
" 2>/dev/null | tail -1 || echo '?')"

FLEUR_NEW="$("$SCRIPTS/fleur-sql.sh" "
SELECT COUNT(*) FROM wp_users
WHERE user_registered >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
LIMIT 1
" 2>/dev/null | tail -1 || echo '?')"

MSG="🌙 *Recap Élude In Art* — $DATE

*Korymb* (ws-default-legacy)
• Notifs non lues: $NOTIF
• Coût LLM aujourd'hui: \$$COST
• Jobs mis à jour aujourd'hui:
\`\`\`
$JOBS_TODAY
\`\`\`

*Fleur d'ÅmÔurs*
• Nouveaux users 24h: $FLEUR_NEW

Demain: briefing 7h. Inbox: https://korymb.eludein.art/inbox"

"$SCRIPTS/eludein-telegram-send.sh" "$MSG" --parse-mode Markdown
