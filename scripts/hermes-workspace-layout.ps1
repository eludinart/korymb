#Requires -Version 5.1
<#
.SYNOPSIS
  Déploie la structure Espaces Hermes (livrables, sources, travail, rep_tech_hermes).

.EXAMPLE
  .\scripts\hermes-workspace-layout.ps1
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" })
)

$ErrorActionPreference = "Stop"
$Script = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\hermes-workspace-layout.sh"
scp -o BatchMode=yes $Script "${Target}:/tmp/hermes-workspace-layout.sh"
ssh -o BatchMode=yes $Target "bash /tmp/hermes-workspace-layout.sh"
scp -o BatchMode=yes (Join-Path (Split-Path -Parent $PSScriptRoot) "ops\hermes\memories\decisions-eric.md") "${Target}:/docker/hermes-agent-aoxw/data/memories/decisions-eric.md"
Write-Host "Termine. Rafraichir WebUI -> Espaces." -ForegroundColor Green
