#Requires -Version 5.1
<#
.SYNOPSIS
  Arrête les jobs de dev lancés par start-dev-cursor.ps1 dans le terminal Cursor.
#>
param()

$ErrorActionPreference = "Stop"
$names = @("tarot-backend-cursor", "tarot-frontend-cursor")

foreach ($name in $names) {
  $j = Get-Job -Name $name -ErrorAction SilentlyContinue
  if ($null -ne $j) {
    Write-Host "Arret job $name ..." -ForegroundColor Yellow
    try { Stop-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
    try { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
  } else {
    Write-Host "Job $name non trouve." -ForegroundColor DarkGray
  }
}

Write-Host "Termine." -ForegroundColor Green
