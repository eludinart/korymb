#Requires -Version 5.1
<#
.SYNOPSIS
  Lance backend + frontend Next dans LE terminal Cursor courant (aucune fenêtre externe).

.DESCRIPTION
  - Démarre backend via backend/restart.ps1 dans un job PowerShell interne.
  - Attend /health backend avant de lancer frontend.
  - Démarre frontend via npm --prefix admin run dev dans un job interne.
  - Stream les logs des 2 jobs dans ce même terminal Cursor.
  - Ctrl+C arrête proprement les jobs.

.PARAMETER SkipVerify
  Ignore l'attente active /health avant démarrage frontend.
#>
param(
  [switch] $SkipVerify
)

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot
$backendRestart = Join-Path $rootDir "backend\restart.ps1"
$backendJobName = "tarot-backend-cursor"
$frontendJobName = "tarot-frontend-cursor"

function Stop-ExistingJobByName {
  param([string] $Name)
  $j = Get-Job -Name $Name -ErrorAction SilentlyContinue
  if ($null -ne $j) {
    try { Stop-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
    try { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
  }
}

if (-not (Test-Path -LiteralPath $backendRestart)) {
  throw "Script backend introuvable: $backendRestart"
}

Set-Location $rootDir

# Nettoyage jobs précédents
Stop-ExistingJobByName -Name $backendJobName
Stop-ExistingJobByName -Name $frontendJobName

Write-Host "Demarrage backend (job interne Cursor)..." -ForegroundColor Cyan
$backendJob = Start-Job -Name $backendJobName -ScriptBlock {
  param([string] $Root, [string] $ScriptPath)
  Set-Location $Root
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ScriptPath
} -ArgumentList $rootDir, $backendRestart

if (-not $SkipVerify) {
  Write-Host "Attente backend /health..." -ForegroundColor Cyan
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:8020/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) {
    throw "Backend non pret sur /health apres attente. Voir logs [tarot-backend-cursor]."
  }
}

Write-Host "Demarrage frontend Next (job interne Cursor)..." -ForegroundColor Cyan
$frontendJob = Start-Job -Name $frontendJobName -ScriptBlock {
  param([string] $Root)
  Set-Location $Root
  & npm --prefix admin run dev
} -ArgumentList $rootDir

Write-Host ""
Write-Host "Serveurs lances dans Cursor. Ctrl+C pour arreter." -ForegroundColor Green
Write-Host "Frontend: http://127.0.0.1:3000/dashboard" -ForegroundColor Gray
Write-Host "Backend : http://127.0.0.1:8020/health" -ForegroundColor Gray
Write-Host ""

try {
  while ($true) {
    foreach ($j in @($backendJob, $frontendJob)) {
      if ($null -eq $j) { continue }
      $out = Receive-Job -Job $j -ErrorAction SilentlyContinue
      foreach ($line in $out) {
        if ($line -ne $null -and "$line".Length -gt 0) {
          Write-Host "[$($j.Name)] $line"
        }
      }
    }

    if ($backendJob.State -in @("Failed", "Stopped", "Completed")) { break }
    if ($frontendJob.State -in @("Failed", "Stopped", "Completed")) { break }
    Start-Sleep -Milliseconds 700
  }

  Write-Host ""
  Write-Host "Un service s'est arrete:" -ForegroundColor Yellow
  Write-Host " - backend : $($backendJob.State)" -ForegroundColor Yellow
  Write-Host " - frontend: $($frontendJob.State)" -ForegroundColor Yellow
  Write-Host "Relance avec .\\start-dev-cursor.ps1" -ForegroundColor Yellow
}
finally {
  Write-Host ""
  Write-Host "Arret des jobs..." -ForegroundColor Yellow
  foreach ($n in @($backendJobName, $frontendJobName)) {
    $j = Get-Job -Name $n -ErrorAction SilentlyContinue
    if ($null -ne $j) {
      try { Stop-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
      try { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
}
