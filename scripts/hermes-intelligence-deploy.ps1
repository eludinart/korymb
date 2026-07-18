#Requires -Version 5.1
<#
.SYNOPSIS
  Déploie l'intelligence Hermes : SOUL, mémoire, skills P0/P1, scripts, crons.

.EXAMPLE
  .\scripts\hermes-intelligence-deploy.ps1
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [string] $HermesDir = "/docker/hermes-agent-aoxw"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$HermesOps = Join-Path $RepoRoot "ops\hermes"
$SkillsRoot = Join-Path $RepoRoot "ops\hermes-skills"
$ScriptsDir = Join-Path $RepoRoot "ops\hermes-scripts"
$HostScriptsDir = Join-Path $ScriptsDir "host"

$skills = @(
  "eludein-ops-rules",
  "eludein-ecosystem",
  "eludein-daily-briefing",
  "korymb-api-bridge",
  "korymb-inbox-triage",
  "korymb-analytics",
  "fleur-analytics",
  "fleur-growth-snapshot",
  "eludein-content-radar",
  "coolify-services-map",
  "eludein-backup-checklist",
  "eludein-log-watcher",
  "hermes-vps-health",
  "hermes-db-analysis",
  "hermes-deploy-check"
)

$scripts = @(
  "korymb-sql.sh",
  "fleur-sql.sh",
  "eludein-db-check.sh",
  "eludein-sql.sh",
  "korymb-api.sh",
  "eludein-telegram-send.sh",
  "eludein-morning-briefing.sh",
  "eludein-evening-recap.sh",
  "eludein-alerts.sh",
  "eludein-post-deploy-smoke.sh",
  "eludein-log-watch.sh"
)

$hostScripts = @(
  "korymb-sql.sh",
  "fleur-sql.sh",
  "eludein-db-check.sh",
  "eludein-sql.sh",
  "korymb-api.sh",
  "eludein-telegram-send.sh",
  "eludein-morning-briefing.sh",
  "eludein-evening-recap.sh",
  "eludein-alerts.sh",
  "eludein-post-deploy-smoke.sh",
  "eludein-log-watch.sh"
)

Write-Host "=== Deploiement intelligence Hermes (P0+P1) ===" -ForegroundColor Cyan

$TarPath = Join-Path $env:TEMP "hermes-intel.tgz"
$RemoteInstall = Join-Path $PSScriptRoot "hermes-intel-remote-install.sh"
if (-not (Test-Path $RemoteInstall)) { throw "Script manquant: $RemoteInstall" }

Push-Location (Join-Path $RepoRoot "ops")
try {
  & tar -czf $TarPath hermes hermes-skills hermes-scripts
} finally {
  Pop-Location
}

scp -o BatchMode=yes $TarPath "${Target}:/tmp/hermes-intel.tgz"
scp -o BatchMode=yes $RemoteInstall "${Target}:/tmp/hermes-intel-remote-install.sh"
scp -o BatchMode=yes (Join-Path $HermesOps "crontab-eludein.txt") "${Target}:/tmp/crontab-eludein.txt"
ssh -o BatchMode=yes $Target "bash /tmp/hermes-intel-remote-install.sh"

Write-Host "`n=== Verification ===" -ForegroundColor Cyan
ssh -o BatchMode=yes $Target @'
echo "Skills deployees:"
ls -1 /docker/hermes-agent-aoxw/data/skills/ | grep -E "eludein|korymb|fleur|hermes|coolify" | sort
echo ""
test -f /docker/hermes-agent-aoxw/data/memories/decisions-eric.md && echo "decisions-eric.md OK"
echo ""
/opt/data/scripts/eludein-db-check.sh
echo ""
if grep -qE '^KORYMB_AGENT_SECRET=' /opt/data/.env 2>/dev/null; then
  /opt/data/scripts/korymb-api.sh GET /health | head -5
else
  echo "KORYMB_AGENT_SECRET absent — ajouter pour pont API (voir docs/HERMES-INTELLIGENCE.md)"
fi
'@

Write-Host "`n=== Skills recommandees ===" -ForegroundColor Yellow
Write-Host "  P0: eludein-daily-briefing, korymb-api-bridge, coolify-services-map"
Write-Host "  P1: korymb-inbox-triage, fleur-growth-snapshot, eludein-content-radar"
Write-Host "  Ops: eludein-backup-checklist, eludein-log-watcher"
Write-Host "`nCrons: .\scripts\hermes-cron-install.ps1" -ForegroundColor Gray
Write-Host "Termine." -ForegroundColor Green
