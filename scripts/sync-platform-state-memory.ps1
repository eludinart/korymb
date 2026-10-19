# Sync docs/PLATFORM_STATE.md → mémoire entreprise (volet developpeur).
# Usage :
#   .\scripts\sync-platform-state-memory.ps1
#   .\scripts\sync-platform-state-memory.ps1 -BaseUrl http://127.0.0.1:8020
#   .\scripts\sync-platform-state-memory.ps1 -BaseUrl https://api-korymb.eludein.art
#
# Secret : AGENT_API_SECRET (env) ou backend/.env.local / .env

param(
  [string]$BaseUrl = "http://127.0.0.1:8020",
  [string]$WorkspaceId = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $RepoRoot "docs\PLATFORM_STATE.md"

if (-not (Test-Path $StateFile)) {
  throw "Fichier manquant : $StateFile"
}

function Read-DotEnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path -ErrorAction SilentlyContinue) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $k, $v = $line.Split("=", 2)
    if ($k.Trim() -eq $Key) {
      return $v.Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

$secret = $env:AGENT_API_SECRET
if (-not $secret) {
  $secret = Read-DotEnvValue (Join-Path $RepoRoot "backend\.env.local") "AGENT_API_SECRET"
}
if (-not $secret) {
  $secret = Read-DotEnvValue (Join-Path $RepoRoot "backend\.env") "AGENT_API_SECRET"
}
if (-not $secret) {
  $secret = Read-DotEnvValue (Join-Path $RepoRoot ".env") "AGENT_API_SECRET"
}
if (-not $secret) {
  throw "AGENT_API_SECRET introuvable (env ou backend/.env.local)."
}

$raw = Get-Content $StateFile -Raw -Encoding UTF8
$bodyText = @"
État plateforme Korymb (sync depuis docs/PLATFORM_STATE.md).
Source de vérité courte pour le CIO — mettre à jour après chaque chantier déployé.

$raw
"@

$payload = @{ contexts = @{ developpeur = $bodyText } } | ConvertTo-Json -Depth 5
$headers = @{
  "X-Agent-Secret" = $secret
  "Content-Type"   = "application/json"
}
if ($WorkspaceId) {
  $headers["X-Workspace-Id"] = $WorkspaceId
}

$url = ($BaseUrl.TrimEnd("/")) + "/memory"
Write-Host "PUT $url (volet developpeur)…" -ForegroundColor Cyan
$res = Invoke-RestMethod -Method Put -Uri $url -Headers $headers -Body $payload
$updated = $res.updated_at
$len = 0
if ($res.contexts -and $res.contexts.developpeur) {
  $len = ([string]$res.contexts.developpeur).Length
}
Write-Host "OK — updated_at=$updated · developpeur=${len} chars" -ForegroundColor Green
