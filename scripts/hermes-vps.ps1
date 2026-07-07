#Requires -Version 5.1
<#
.SYNOPSIS
  Administration Hermes Agent sur le VPS à distance.

.DESCRIPTION
  Actions courantes via SSH (status, logs, restart, config, health).
  Ne stocke aucun secret — utilise la session SSH existante.

.PARAMETER Action
  status | logs | restart | config | health | compose

.EXAMPLE
  .\scripts\hermes-vps.ps1 status
  .\scripts\hermes-vps.ps1 logs -Tail 80
  .\scripts\hermes-vps.ps1 restart
#>
param(
  [ValidateSet("status", "logs", "restart", "config", "health", "compose", "fix-perms")]
  [string] $Action = "status",
  [int] $Tail = 50,
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" })
)

$ErrorActionPreference = "Stop"
$HermesDir = "/docker/hermes-agent-aoxw"
$Container = "hermes-agent-aoxw-hermes-agent-1"

function Invoke-Remote {
  param([string] $Command)
  & ssh -o BatchMode=yes -o ConnectTimeout=15 $Target $Command
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

switch ($Action) {
  "status" {
    Write-Host "=== Hermes compose ===" -ForegroundColor Cyan
    Invoke-Remote "cd $HermesDir && docker compose ps"
    Write-Host "`n=== HTTPS ===" -ForegroundColor Cyan
    Invoke-Remote "curl -s -o /dev/null -w 'hermes.eludein.art HTTP %{http_code}\n' https://hermes.eludein.art/"
  }
  "logs" {
    Invoke-Remote "cd $HermesDir && docker compose logs --tail $Tail"
  }
  "restart" {
    Write-Host "Redémarrage Hermes..." -ForegroundColor Yellow
    Invoke-Remote "cd $HermesDir && docker compose up -d --force-recreate && sleep 5 && docker compose ps"
  }
  "config" {
    Invoke-Remote "docker exec $Container bash -lc 'gosu hermes hermes config show 2>&1' | head -40"
  }
  "health" {
    Invoke-Remote @"
echo '--- dashboard ---'
tail -5 $HermesDir/data/logs/dashboard.log 2>/dev/null || true
echo '--- gateway ---'
tail -5 $HermesDir/data/logs/gateway.log 2>/dev/null || true
echo '--- curl ---'
curl -s -o /dev/null -w 'hermes.eludein.art %{http_code}\n' https://hermes.eludein.art/
"@
  }
  "compose" {
    Invoke-Remote "cat $HermesDir/docker-compose.yml"
  }
  "fix-perms" {
    Write-Host "Correction propriétaire data/.env (hermes UID 10000)..." -ForegroundColor Yellow
    Invoke-Remote "chown 10000:10000 $HermesDir/data/.env && chmod 600 $HermesDir/data/.env && ls -la $HermesDir/data/.env && docker exec $Container bash -lc 'gosu hermes test -r /opt/data/.env && echo OK'"
  }
}
