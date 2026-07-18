#Requires -Version 5.1
<#
.SYNOPSIS
  Intègre Hermes WebUI dans le compose agent existant sur le VPS.

.DESCRIPTION
  1. Sauvegarde docker-compose.yml
  2. Déploie ops/hermes/docker-compose.yml (agent + webui)
  3. Arrête le conteneur standalone hermes-webui
  4. docker compose up -d
  5. Vérifie connectivité agent depuis WebUI

.EXAMPLE
  .\scripts\hermes-webui-integrate.ps1
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [string] $HermesDir = "/docker/hermes-agent-aoxw"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $RepoRoot "ops\hermes\docker-compose.yml"

if (-not (Test-Path $ComposeFile)) { throw "Fichier introuvable: $ComposeFile" }

Write-Host "=== Integration Hermes WebUI -> compose agent ===" -ForegroundColor Cyan
Write-Host "  VPS : $Target"
Write-Host "  Dir : $HermesDir"
Write-Host ""

ssh -o BatchMode=yes $Target @'
set -euo pipefail
cd /docker/hermes-agent-aoxw
cp docker-compose.yml "docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)"
mkdir -p data/hermes-webui-state
'@

scp -o BatchMode=yes $ComposeFile "${Target}:${HermesDir}/docker-compose.yml"

ssh -o BatchMode=yes $Target @'
set -euo pipefail
AGENT=hermes-agent-aoxw-hermes-agent-1
HERMES_DIR=/docker/hermes-agent-aoxw
SRC="$HERMES_DIR/hermes-agent-src"

echo "=== Sync hermes-agent source (/opt/hermes) pour WebUI skills ==="
mkdir -p "$SRC"
# Copie depuis le conteneur agent (image Hostinger) — requis pour module Python agent
docker cp "$AGENT:/opt/hermes/." "$SRC/"
test -f "$SRC/pyproject.toml" && test -d "$SRC/agent" && echo "hermes-agent-src OK"

# Arreter stack standalone WebUI si presente
if docker ps -a --format "{{.Names}}" | grep -qx hermes-webui; then
  docker stop hermes-webui 2>/dev/null || true
  docker rm hermes-webui 2>/dev/null || true
fi
if [ -f /opt/data/docker-compose-hermes-webui.yml ]; then
  mv /opt/data/docker-compose-hermes-webui.yml /opt/data/docker-compose-hermes-webui.yml.disabled 2>/dev/null || true
fi

cd "$HERMES_DIR"
docker compose up -d --force-recreate hermes-webui
echo "Attente init WebUI (pip install agent)..."
sleep 45
docker compose ps

echo ""
echo "=== Health WebUI ==="
curl -s http://127.0.0.1:3001/health | head -c 200
echo ""

echo "=== API skills ==="
curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:3001/api/skills 2>&1 | head -20

echo "=== Agent prod HTTPS ==="
curl -s -o /dev/null -w "hermes.eludein.art HTTP %{http_code}\n" https://hermes.eludein.art/
curl -s -o /dev/null -w "hermeswebui.eludein.art HTTP %{http_code}\n" https://hermeswebui.eludein.art/health
'@

Write-Host "`nTermine. WebUI : https://hermeswebui.eludein.art — Agent : https://hermes.eludein.art" -ForegroundColor Green
