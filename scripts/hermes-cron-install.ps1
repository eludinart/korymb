#Requires -Version 5.1
<#
.SYNOPSIS
  Installe les crons Élude In Art sur le VPS (briefing, alertes, smoke, logs).

.DESCRIPTION
  Fusionne ops/hermes/crontab-eludein.txt avec le crontab existant sans dupliquer les lignes eludein-*.

.EXAMPLE
  .\scripts\hermes-cron-install.ps1
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" })
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$CrontabFile = Join-Path $RepoRoot "ops\hermes\crontab-eludein.txt"

Write-Host "=== Installation crons Eludein ===" -ForegroundColor Cyan
scp -o BatchMode=yes $CrontabFile "${Target}:/tmp/crontab-eludein.txt"

ssh -o BatchMode=yes $Target @'
set -euo pipefail
MARKER="# eludein-hermes-crons"
TMP="$(mktemp)"
( crontab -l 2>/dev/null | grep -v 'eludein-morning-briefing' | grep -v 'eludein-evening-recap' \
  | grep -v 'eludein-alerts' | grep -v 'eludein-post-deploy-smoke' | grep -v 'eludein-log-watch' \
  | grep -v "$MARKER" || true ) > "$TMP"
echo "$MARKER" >> "$TMP"
grep -E '^[0-9]|^#' /tmp/crontab-eludein.txt | grep -v '^#' >> "$TMP"
crontab "$TMP"
rm -f "$TMP"
echo "Crontab actuel:"
crontab -l
'@

Write-Host "Termine." -ForegroundColor Green
