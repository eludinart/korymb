#Requires -Version 5.1
<#
.SYNOPSIS
  Arrête les jobs de dev lancés par start-dev-cursor.ps1 dans le terminal Cursor.
#>
param()

$ErrorActionPreference = "Stop"
$names = @("tarot-backend-cursor", "tarot-frontend-cursor")

function Stop-ProcessesOnPort {
  param([int] $Port, [string] $Label = "")
  $tag = if ($Label) { " ($Label)" } else { "" }
  $listening = @(
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  ) | Where-Object { $_ -and $_ -gt 0 } | Select-Object -Unique
  foreach ($portPid in $listening) {
    $proc = Get-Process -Id $portPid -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host ("  Arret PID {0} ({1}) sur port {2}{3}..." -f $portPid, $proc.ProcessName, $Port, $tag) -ForegroundColor DarkGray
      # Start-Process évite le gel que cause cmd.exe/taskkill /T sur les arborescences Node
      $kill = Start-Process -FilePath "taskkill" -ArgumentList "/F /PID $portPid /T" `
        -WindowStyle Hidden -PassThru -ErrorAction SilentlyContinue
      if ($kill) { $null = $kill.WaitForExit(3000) }
      Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
    }
  }
}

# Tuer d'abord les processus serveurs réels (uvicorn, node/next) pour ne pas bloquer sur Stop-Job
Stop-ProcessesOnPort -Port 8020 -Label "backend/uvicorn"
Stop-ProcessesOnPort -Port 3000 -Label "frontend/next"

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
