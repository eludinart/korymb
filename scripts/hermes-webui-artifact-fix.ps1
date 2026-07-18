#Requires -Version 5.1
<#
.SYNOPSIS
  Corrige l'ouverture des artefacts WebUI (chemins absolus sous /opt/data).

.EXAMPLE
  .\scripts\hermes-webui-artifact-fix.ps1
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [string] $HermesDir = "/docker/hermes-agent-aoxw"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Patches = Join-Path $RepoRoot "ops\hermes\webui-patches"
$RemotePatch = "$HermesDir/hermes-webui-patches/apply-patches.sh"

Write-Host "=== Patch artefacts WebUI ===" -ForegroundColor Cyan
ssh -o BatchMode=yes $Target "mkdir -p $HermesDir/hermes-webui-patches"
scp -o BatchMode=yes (Join-Path $Patches "apply-patches.sh") "${Target}:${RemotePatch}"
scp -o BatchMode=yes (Join-Path $RepoRoot "ops\hermes\docker-compose.yml") "${Target}:${HermesDir}/docker-compose.yml"

ssh -o BatchMode=yes $Target "chmod +x $RemotePatch && cd $HermesDir && docker compose up -d --force-recreate hermes-webui && sleep 10 && docker compose ps hermes-webui && docker exec hermes-agent-aoxw-hermes-webui-1 grep -q HERMES_HOME_ABSPATH_READ /app/api/routes.py && echo patch_ok"

Write-Host "Termine. Rafraichir WebUI et recliquer l'artefact." -ForegroundColor Green
