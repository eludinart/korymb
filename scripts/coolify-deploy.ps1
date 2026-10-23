#Requires -Version 5.1
<#
.SYNOPSIS
  Commit déjà poussé → file un (ou deux) déploiement(s) Coolify Korymb et attend la fin.

.DESCRIPTION
  Helpers PHP dans scripts/coolify/ copiés dans le conteneur coolify, puis
  queue_application_deployment (force rebuild). Un seul deploy à la fois sur le VPS
  (next build = gourmand en RAM).

.PARAMETER Target
  front | back | both

.EXAMPLE
  .\scripts\coolify-deploy.ps1 -Target front
  .\scripts\coolify-deploy.ps1 -Target both
#>
param(
  [ValidateSet("front", "back", "both")]
  [string] $Target = "front",
  [string] $SshTarget = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [int] $PollSeconds = 20,
  [int] $MaxTicks = 80,
  [switch] $SkipSmoke
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$HelperDir = Join-Path $PSScriptRoot "coolify"

# UUIDs Coolify (prod Korymb) — rafraîchir via list-korymb-apps.php si besoin
$FrontUuid = "z112nva69fa5wvvsku0rey6b"
$BackUuid = "q3fnxjqmpfnlr77wfk1wn9ls"

function Invoke-Ssh([string]$Remote) {
  & ssh -o BatchMode=yes -o ConnectTimeout=20 $SshTarget $Remote
  if ($LASTEXITCODE -ne 0) {
    throw "ssh failed ($LASTEXITCODE): $Remote"
  }
}

function Ensure-Helpers {
  $files = @("list-korymb-apps.php", "queue-by-uuid.php", "deploy-status.php")
  foreach ($f in $files) {
    $local = Join-Path $HelperDir $f
    if (-not (Test-Path $local)) { throw "Missing helper: $local" }
  }
  Write-Host "Upload helpers → $SshTarget:/tmp/coolify-*.php" -ForegroundColor Cyan
  & scp -o BatchMode=yes -o ConnectTimeout=20 `
    (Join-Path $HelperDir "list-korymb-apps.php") `
    (Join-Path $HelperDir "queue-by-uuid.php") `
    (Join-Path $HelperDir "deploy-status.php") `
    "${SshTarget}:/tmp/"
  if ($LASTEXITCODE -ne 0) { throw "scp failed ($LASTEXITCODE)" }
  Invoke-Ssh @"
docker cp /tmp/list-korymb-apps.php coolify:/tmp/list-korymb-apps.php
docker cp /tmp/queue-by-uuid.php coolify:/tmp/queue-by-uuid.php
docker cp /tmp/deploy-status.php coolify:/tmp/deploy-status.php
"@
}

function Queue-And-Wait([string]$Label, [string]$Uuid) {
  Write-Host "Queue $Label ($Uuid)…" -ForegroundColor Cyan
  $out = & ssh -o BatchMode=yes -o ConnectTimeout=20 $SshTarget "docker exec coolify php /tmp/queue-by-uuid.php $Uuid"
  if ($LASTEXITCODE -ne 0) {
    throw "queue $Label failed: $out"
  }
  $id = ($out | Select-Object -Last 1).ToString().Trim()
  if (-not $id) { throw "no deployment uuid for $Label" }
  Write-Host "$Label deploy id=$id" -ForegroundColor Gray

  $st = "unknown"
  for ($i = 1; $i -le $MaxTicks; $i++) {
    Start-Sleep -Seconds $PollSeconds
    $st = (& ssh -o BatchMode=yes -o ConnectTimeout=20 $SshTarget "docker exec coolify php /tmp/deploy-status.php $id").ToString().Trim()
    Write-Host "tick $i $Label $st"
    if ($st -match '^(finished|failed|cancelled|error)$') {
      if ($st -ne 'finished') { throw "$Label deploy ended: $st" }
      Write-Host "$Label DONE" -ForegroundColor Green
      return
    }
  }
  throw "$Label deploy timeout (last=$st)"
}

Push-Location $RepoRoot
try {
  Ensure-Helpers

  $order = @()
  if ($Target -eq "back" -or $Target -eq "both") { $order += @{ Name = "back"; Uuid = $BackUuid } }
  if ($Target -eq "front" -or $Target -eq "both") { $order += @{ Name = "front"; Uuid = $FrontUuid } }

  # Un à la fois : back d'abord si both (API avant UI)
  foreach ($item in $order) {
    Queue-And-Wait $item.Name $item.Uuid
  }

  if (-not $SkipSmoke) {
    Write-Host "Smoke post-deploy…" -ForegroundColor Cyan
    & node (Join-Path $RepoRoot "tools\smoke-post-deploy.mjs") `
      --app-url "https://korymb.eludein.art" `
      --backend-url "https://api-korymb.eludein.art"
    if ($LASTEXITCODE -ne 0) { throw "smoke failed ($LASTEXITCODE)" }
  }

  Write-Host "OK — déployé: $Target" -ForegroundColor Green
}
finally {
  Pop-Location
}
