#Requires -Version 5.1
<#
.SYNOPSIS
  Tunnel SSH local vers MariaDB Coolify sur le VPS (dev Windows).

.DESCRIPTION
  Forward 127.0.0.1:<LocalPort> -> <RemoteDbHost>:<RemotePort> via SSH sur le VPS.
  Le hostname Coolify interne (ex. juehpsn...) n'est resolvable que depuis le VPS.

.PARAMETER SshTarget
  Cible SSH (ex. root@187.124.42.135 ou deploy@eludein.art).

.PARAMETER RemoteDbHost
  Host MariaDB vu depuis le VPS (hostname service Coolify).

.PARAMETER RemotePort
  Port MariaDB sur le reseau Docker Coolify (souvent 3306).

.PARAMETER LocalPort
  Port local a ecouter (aligner avec KORYMB_DB_PORT dans backend/.env.local).
#>
param(
  [string] $SshTarget = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [string] $RemoteDbHost = "",
  [int] $RemotePort = $(if ($env:KORYMB_VPS_DB_PORT) { [int]$env:KORYMB_VPS_DB_PORT } else { 3306 }),
  [int] $LocalPort = $(if ($env:KORYMB_DB_PORT) { [int]$env:KORYMB_DB_PORT } else { 3307 })
)

$ErrorActionPreference = "Stop"

function Read-DotEnvValue {
  param([string] $FilePath, [string] $Key)
  if (-not (Test-Path -LiteralPath $FilePath)) { return $null }
  foreach ($line in Get-Content -LiteralPath $FilePath) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+?)\s*$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

if (-not $RemoteDbHost) {
  # Depuis le VPS en SSH, MariaDB est en général sur 127.0.0.1 — pas le hostname Docker Coolify (FLEUR_DB_HOST).
  if ($env:KORYMB_VPS_DB_HOST) {
    $RemoteDbHost = $env:KORYMB_VPS_DB_HOST
  }
  else {
    $RemoteDbHost = "127.0.0.1"
  }
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "OpenSSH client introuvable. Installez le client SSH Windows ou utilisez Git Bash."
}

Write-Host "Tunnel MariaDB VPS" -ForegroundColor Cyan
Write-Host "  Local  : 127.0.0.1:$LocalPort"
Write-Host "  Remote : ${RemoteDbHost}:$RemotePort via $SshTarget"
Write-Host ""
Write-Host "backend/.env.local attend en general :" -ForegroundColor Gray
Write-Host "  KORYMB_DB_ENGINE=mariadb"
Write-Host "  KORYMB_DB_HOST=127.0.0.1"
Write-Host "  KORYMB_DB_PORT=$LocalPort"
Write-Host ""
Write-Host "Laissez cette fenetre ouverte. Ctrl+C pour arreter." -ForegroundColor Yellow
Write-Host ""

$bind = "127.0.0.1:${LocalPort}:${RemoteDbHost}:${RemotePort}"
ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L $bind $SshTarget
