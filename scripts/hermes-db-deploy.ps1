#Requires -Version 5.1
<#
.SYNOPSIS
  Déploie scripts/skills SQL Hermes (conteneur + wrappers hôte SSH).

.DESCRIPTION
  Le terminal SSH Hermes s'exécute sur l'hôte VPS (/opt/data), pas dans le conteneur.
  Les wrappers hôte délèguent via docker exec aux vrais scripts du conteneur.

.EXAMPLE
  .\scripts\hermes-db-deploy.ps1
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [string] $HermesDir = "/docker/hermes-agent-aoxw"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptsDir = Join-Path $RepoRoot "ops\hermes-scripts"
$HostScriptsDir = Join-Path $ScriptsDir "host"
$SkillsRoot = Join-Path $RepoRoot "ops\hermes-skills"

$scripts = @("korymb-sql.sh", "fleur-sql.sh", "eludein-db-check.sh", "eludein-sql.sh")
$skills = @("korymb-analytics", "fleur-analytics", "eludein-ecosystem")

Write-Host "=== Deploiement scripts conteneur Hermes ===" -ForegroundColor Cyan

foreach ($s in $scripts) {
  $local = Join-Path $ScriptsDir $s
  if (-not (Test-Path $local)) { throw "Manquant: $local" }
  scp -o BatchMode=yes $local "${Target}:${HermesDir}/data/scripts/$s"
}

foreach ($sk in $skills) {
  $local = Join-Path $SkillsRoot "$sk\SKILL.md"
  if (-not (Test-Path $local)) { throw "Manquant: $local" }
  ssh -o BatchMode=yes $Target "mkdir -p ${HermesDir}/data/skills/$sk"
  scp -o BatchMode=yes $local "${Target}:${HermesDir}/data/skills/$sk/SKILL.md"
}

ssh -o BatchMode=yes $Target "chmod +x ${HermesDir}/data/scripts/*.sh && chown -R 10000:10000 ${HermesDir}/data/scripts ${HermesDir}/data/skills/korymb-analytics ${HermesDir}/data/skills/fleur-analytics ${HermesDir}/data/skills/eludein-ecosystem 2>/dev/null || true"

Write-Host "`n=== Wrappers hote VPS (/opt/data/scripts — terminal SSH Hermes) ===" -ForegroundColor Cyan

foreach ($s in $scripts) {
  $local = Join-Path $HostScriptsDir $s
  if (-not (Test-Path $local)) { throw "Wrapper manquant: $local" }
  scp -o BatchMode=yes $local "${Target}:/opt/data/scripts/$s"
}

ssh -o BatchMode=yes $Target @'
set -euo pipefail
mkdir -p /opt/data/scripts
if [ -f /opt/data/.env ] && [ ! -L /opt/data/.env ]; then
  mv /opt/data/.env "/opt/data/.env.hermes-broken.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
fi
ln -sf /docker/hermes-agent-aoxw/data/.env /opt/data/.env
rm -f /opt/data/scripts/general-sql.sh /opt/data/korymb_db.py /opt/data/grant_hermes.sql 2>/dev/null || true
chmod +x /opt/data/scripts/*.sh
'@

Write-Host "`n=== Verification conteneur ===" -ForegroundColor Cyan
ssh -o BatchMode=yes $Target 'docker exec hermes-agent-aoxw-hermes-agent-1 /opt/data/scripts/eludein-db-check.sh'

Write-Host "`n=== Verification hote SSH (comme terminal Hermes) ===" -ForegroundColor Cyan
ssh -o BatchMode=yes $Target '/opt/data/scripts/eludein-db-check.sh'

Write-Host "`nTermine." -ForegroundColor Green
