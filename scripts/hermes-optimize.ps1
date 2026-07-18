#Requires -Version 5.1
<#
.SYNOPSIS
  Optimise l'environnement Hermes complet sur le VPS (agent, WebUI, hôte, crons).

.EXAMPLE
  .\scripts\hermes-optimize.ps1
  .\scripts\hermes-optimize.ps1 -SkipIntelligence
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [switch] $SkipIntelligence,
  [switch] $SkipCrons
)

$ErrorActionPreference = "Stop"
$Scripts = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts"

$toCopy = @(
  "hermes-optimize.sh",
  "hermes-host-sync.sh",
  "hermes-workspace-layout.sh",
  "hermes-artifacts-paths-fix.sh"
)

Write-Host "=== Optimisation Hermes ===" -ForegroundColor Cyan
foreach ($f in $toCopy) {
  scp -o BatchMode=yes (Join-Path $Scripts $f) "${Target}:/tmp/$f"
}

if (-not $SkipIntelligence) {
  Write-Host "`n--- Intelligence (skills, SOUL, scripts) ---" -ForegroundColor Yellow
  & (Join-Path $Scripts "hermes-intelligence-deploy.ps1") -Target $Target
}

if (-not $SkipCrons) {
  Write-Host "`n--- Crons hôte ---" -ForegroundColor Yellow
  & (Join-Path $Scripts "hermes-cron-install.ps1") -Target $Target
}

Write-Host "`n--- Optimisation runtime ---" -ForegroundColor Yellow
ssh -o BatchMode=yes $Target "chmod +x /tmp/hermes-*.sh && bash /tmp/hermes-optimize.sh"

Write-Host "`nTermine. Rafraichir https://hermeswebui.eludein.art" -ForegroundColor Green
