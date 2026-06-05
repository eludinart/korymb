#Requires -Version 5.1
<#
.SYNOPSIS
  Lance backend + frontend Next dans LE terminal Cursor courant (aucune fenêtre externe).

.DESCRIPTION
  - Démarre backend via backend/restart.ps1 dans un job PowerShell interne.
  - Attend /health backend (code_dir + version) avant de lancer frontend.
  - Surveille /health et redémarre automatiquement le backend si injoignable ou trop lent.
  - Démarre frontend via node (next dev -p 3000) en processus détaché (les jobs PS cassent Next sous Windows).
  - Stream les logs backend (job) + frontend (fichiers) dans ce même terminal Cursor.
  - Ctrl+C arrête proprement les jobs.

.PARAMETER SkipVerify
  Ignore l'attente active /health avant démarrage frontend.

.PARAMETER MariaDbTunnel
  Demarre scripts/mariadb-vps-tunnel.ps1 en job arriere-plan (dev -> MariaDB VPS).

.PARAMETER Reload
  Active uvicorn --reload (desactive par defaut : plus stable sous Windows).
#>
param(
  [switch] $SkipVerify,
  [switch] $MariaDbTunnel,
  [switch] $Reload
)

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$backendRestart = Join-Path $backendDir "restart.ps1"
$backendJobName = "korymb-backend-cursor"
$frontendJobName = "korymb-frontend-cursor"
$tunnelJobName = "korymb-mariadb-tunnel"
$mariadbTunnelScript = Join-Path $rootDir "scripts\mariadb-vps-tunnel.ps1"
$healthUrl = "http://127.0.0.1:8020/health"
$livenessUrl = "http://127.0.0.1:8020/health/live"
$watchdogIntervalSec = 15
$watchdogFailThreshold = 4
$watchdogGraceSec = 50
$backendProc = $null
$backendLog = $null
$backendLogOffset = 0
$watchdogGraceUntil = [datetime]::MinValue
$frontendProc = $null
$frontendLogOut = $null
$frontendLogErr = $null
$frontendLogOffsetOut = 0
$frontendLogOffsetErr = 0

function Stop-ExistingJobByName {
  param([string] $Name)
  $j = Get-Job -Name $Name -ErrorAction SilentlyContinue
  if ($null -ne $j) {
    try { Stop-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
    try { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
  }
}

function Stop-ProcessesOnPort {
  param([int] $Port, [string] $Label = "")
  $tag = if ($Label) { " ($Label)" } else { "" }
  $listening = @(
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  ) | Where-Object { $_ -and $_ -gt 0 } | Select-Object -Unique
  foreach ($portPid in $listening) {
    if ($portPid -eq $PID) { continue }
    $proc = Get-Process -Id $portPid -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host ("  Arret PID {0} ({1}) sur port {2}{3}..." -f $portPid, $proc.ProcessName, $Port, $tag) -ForegroundColor DarkGray
      $null = cmd.exe /c "taskkill /F /PID $portPid /T 2>nul 1>nul"
      Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-ExpectedBackendVersion {
  $versionFile = Join-Path $backendDir "version.py"
  if (-not (Test-Path -LiteralPath $versionFile)) { return "" }
  $text = Get-Content -LiteralPath $versionFile -Raw -Encoding utf8
  if ($text -match 'BACKEND_VERSION\s*=\s*["'']([^"'']+)["'']') {
    return $Matches[1].Trim()
  }
  return ""
}

function Test-BackendHealthReady {
  param(
    [int] $TimeoutSec = 3,
    [ref] $ElapsedMs
  )
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec $TimeoutSec
    if ($r.StatusCode -ne 200) { return $false }
    $body = $r.Content | ConvertFrom-Json -ErrorAction Stop
    $codeDir = [string]$body.code_dir
    if (-not $codeDir) { return $false }
    $expectedDir = (Resolve-Path -LiteralPath $backendDir).Path
    $actualDir = ($codeDir -replace '/', '\').TrimEnd('\')
    $expectedNorm = $expectedDir.TrimEnd('\')
    if ($actualDir -ne $expectedNorm) { return $false }
    $expectedVer = Get-ExpectedBackendVersion
    if ($expectedVer) {
      $ver = [string]$body.version
      $rev = [string]$body.revision
      if ($ver -and $ver -ne $expectedVer -and $rev -ne $expectedVer) { return $false }
    }
    if ($PSBoundParameters.ContainsKey("ElapsedMs")) { $ElapsedMs.Value = [int]$sw.ElapsedMilliseconds }
    return $true
  }
  catch {
    if ($PSBoundParameters.ContainsKey("ElapsedMs")) { $ElapsedMs.Value = [int]$sw.ElapsedMilliseconds }
    return $false
  }
  finally {
    $sw.Stop()
  }
}

function Wait-BackendHealthReady {
  param([int] $MaxAttempts = 90, [int] $DelayMs = 500)
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if (Test-BackendHealthReady -TimeoutSec 3) { return $true }
    Start-Sleep -Milliseconds $DelayMs
  }
  return $false
}

function Test-BackendPortOpen {
  $hit = Get-NetTCPConnection -LocalPort 8020 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return ($null -ne $hit)
}

function Get-DevMariaDbLocalPort {
  $localEnv = Join-Path $backendDir ".env.local"
  if (-not (Test-Path -LiteralPath $localEnv)) { return $null }
  $raw = Get-Content -LiteralPath $localEnv -Raw
  if ($raw -notmatch '(?m)^\s*KORYMB_DB_ENGINE\s*=\s*mariadb\s*$') { return $null }
  if ($raw -match '(?m)^\s*KORYMB_DB_PORT\s*=\s*(\d+)\s*$') { return [int]$Matches[1] }
  return 3307
}

function Test-MariaDbTunnelListening {
  param([int] $Port = 3307)
  $hit = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return ($null -ne $hit)
}

function Restart-MariaDbTunnelJob {
  Write-Host "(watchdog) Redemarrage tunnel MariaDB (remote 127.0.0.1:3306)..." -ForegroundColor Yellow
  Get-NetTCPConnection -LocalPort $script:MariaDbLocalPort -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      if ($_.OwningProcess -and $_.OwningProcess -ne 0) {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
      }
    }
  Stop-ExistingJobByName -Name $tunnelJobName
  $sshTarget = if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }
  $bind = "127.0.0.1:$($script:MariaDbLocalPort):127.0.0.1:3306"
  Start-Process -FilePath "ssh" -ArgumentList @(
    "-f", "-N",
    "-o", "ServerAliveInterval=30",
    "-o", "ExitOnForwardFailure=yes",
    "-L", $bind,
    $sshTarget
  ) -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 3
  return (Test-MariaDbTunnelListening -Port $script:MariaDbLocalPort)
}

function Test-BackendLiveness {
  param([int] $TimeoutSec = 8)
  try {
    $r = Invoke-WebRequest -Uri $livenessUrl -UseBasicParsing -TimeoutSec $TimeoutSec
    return ($r.StatusCode -eq 200)
  }
  catch {
    return $false
  }
}

function Stop-BackendDevProcess {
  if ($null -ne $backendProc -and -not $backendProc.HasExited) {
    try {
      $null = cmd.exe /c "taskkill /F /PID $($backendProc.Id) /T 2>nul 1>nul"
      Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
    catch { }
  }
  $script:backendProc = $null
  Stop-ProcessesOnPort -Port 8020 -Label "backend/uvicorn"
}

function Start-BackendDevProcess {
  $scriptArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $backendRestart)
  if (-not $Reload) { $scriptArgs += "-NoReload" }
  $logDir = Join-Path $rootDir ".dev-logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $script:backendLog = Join-Path $logDir "backend.log"
  if (Test-Path -LiteralPath $script:backendLog) {
    Remove-Item -LiteralPath $script:backendLog -Force -ErrorAction SilentlyContinue
  }
  $script:backendLogOffset = 0
  # Processus detache : les jobs PowerShell coupent uvicorn sous charge Windows.
  $script:backendProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList $scriptArgs `
    -WorkingDirectory $rootDir `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $script:backendLog `
    -RedirectStandardError $script:backendLog
}

function Test-FrontendReady {
  param([int] $Port = 3000, [int] $TimeoutSec = 2)
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec $TimeoutSec
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  }
  catch {
    return $false
  }
}

function Wait-FrontendReady {
  param([int] $Port = 3000, [int] $MaxAttempts = 45, [int] $DelayMs = 400)
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if ((Test-FrontendReady -Port $Port) -and ($null -ne (Get-FrontendListenPid))) {
      Start-Sleep -Milliseconds 300
      if ((Test-FrontendReady -Port $Port) -and ($null -ne (Get-FrontendListenPid))) { return $true }
    }
    Start-Sleep -Milliseconds $DelayMs
  }
  return $false
}

function Write-NewLogLines {
  param([string] $Path, [ref] $Offset, [string] $Prefix)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return }
  $fs = $null
  $reader = $null
  try {
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $fs.Position = $Offset.Value
    $reader = New-Object System.IO.StreamReader($fs)
    while (-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if ($null -ne $line -and "$line".Length -gt 0) {
        Write-Host "$Prefix $line"
      }
    }
    $Offset.Value = $fs.Position
  }
  catch { }
  finally {
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $fs) { $fs.Dispose() }
  }
}

function Get-FrontendListenPid {
  $pids = @(
    Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  ) | Where-Object { $_ -and $_ -gt 0 } | Select-Object -First 1
  if ($pids) { return [int]$pids }
  return $null
}

function Test-FrontendProcessRunning {
  if ($null -ne $frontendProc -and -not $frontendProc.HasExited) { return $true }
  return ($null -ne (Get-FrontendListenPid))
}

function Stop-FrontendDevProcess {
  if ($null -ne $frontendProc -and -not $frontendProc.HasExited) {
    try {
      $null = cmd.exe /c "taskkill /F /PID $($frontendProc.Id) /T 2>nul 1>nul"
      Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
    }
    catch { }
  }
  $script:frontendProc = $null
  foreach ($p in 3000, 3001, 3002) {
    Stop-ProcessesOnPort -Port $p -Label "frontend/next"
  }
}

function Start-FrontendDevProcess {
  $adminDir = Join-Path $rootDir "admin"
  $nextScript = Join-Path $adminDir "node_modules\next\dist\bin\next"
  if (-not (Test-Path -LiteralPath $nextScript)) {
    throw "Next.js introuvable: $nextScript (lancez npm install dans admin/)"
  }
  $logDir = Join-Path $rootDir ".dev-logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $script:frontendLogOut = Join-Path $logDir "frontend.out.log"
  $script:frontendLogErr = Join-Path $logDir "frontend.err.log"
  foreach ($p in @($script:frontendLogOut, $script:frontendLogErr)) {
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
  }
  $script:frontendLogOffsetOut = 0
  $script:frontendLogOffsetErr = 0
  # WindowStyle Hidden : detache du terminal parent (sinon Next quitte apres le 1er compile).
  $script:frontendProc = Start-Process -FilePath "node" `
    -ArgumentList @($nextScript, "dev", "-p", "3000", "-H", "127.0.0.1") `
    -WorkingDirectory $adminDir `
    -PassThru `
    -WindowStyle Hidden
}

function Restart-BackendDevProcess {
  param([string] $Reason = "watchdog")
  Write-Host ""
  Write-Host "(watchdog) Redemarrage backend ($Reason)..." -ForegroundColor Yellow
  Stop-BackendDevProcess
  Start-Sleep -Milliseconds 800
  Start-BackendDevProcess
  $script:watchdogGraceUntil = [datetime]::UtcNow.AddSeconds($watchdogGraceSec)
  if (-not (Wait-BackendHealthReady -MaxAttempts 100 -DelayMs 500)) {
    Write-Host "(watchdog) Backend toujours indisponible apres redemarrage." -ForegroundColor Red
    return $false
  }
  Write-Host "(watchdog) Backend de nouveau operationnel." -ForegroundColor Green
  return $true
}

function Restart-FrontendDevProcess {
  param([string] $Reason = "watchdog")
  Write-Host ""
  Write-Host "(watchdog) Redemarrage frontend ($Reason)..." -ForegroundColor Yellow
  Stop-FrontendDevProcess
  Start-Sleep -Milliseconds 600
  Start-FrontendDevProcess
  $null = Wait-FrontendReady -Port 3000 -MaxAttempts 40 -DelayMs 500
  return $true
}

if (-not (Test-Path -LiteralPath $backendRestart)) {
  throw "Script backend introuvable: $backendRestart"
}

Set-Location $rootDir

Stop-BackendDevProcess
Stop-ExistingJobByName -Name $tunnelJobName
Write-Host "Liberation des ports dev (8020, 3000-3002)..." -ForegroundColor DarkGray
Stop-ProcessesOnPort -Port 8020 -Label "backend/uvicorn"
foreach ($p in 3000, 3001, 3002) {
  Stop-ProcessesOnPort -Port $p -Label "frontend/next"
}
Start-Sleep -Milliseconds 800

$script:MariaDbLocalPort = Get-DevMariaDbLocalPort
$script:MariaDbTunnelEnabled = [bool]$MariaDbTunnel -or ($null -ne $script:MariaDbLocalPort)

if ($MariaDbTunnel) {
  if (-not (Test-Path -LiteralPath $mariadbTunnelScript)) {
    throw "Script tunnel introuvable: $mariadbTunnelScript"
  }
  Write-Host "Demarrage tunnel MariaDB VPS (job interne)..." -ForegroundColor Cyan
  $null = Restart-MariaDbTunnelJob
}
elseif ($null -ne $script:MariaDbLocalPort) {
  if (-not (Test-MariaDbTunnelListening -Port $script:MariaDbLocalPort)) {
    Write-Host ""
    Write-Host "ATTENTION: MariaDB configure (port $($script:MariaDbLocalPort)) mais tunnel ferme." -ForegroundColor Red
    Write-Host "  Briefing / missions / audit reprise echoueront sans tunnel SSH." -ForegroundColor Red
    Write-Host "  Relancez avec: .\start-dev-cursor.ps1 -MariaDbTunnel" -ForegroundColor Yellow
    Write-Host ""
  }
}

Write-Host "Demarrage backend (processus detache, sans --reload par defaut)..." -ForegroundColor Cyan
Start-BackendDevProcess

if (-not $SkipVerify) {
  Write-Host "Attente backend /health (code_dir + version)..." -ForegroundColor Cyan
  if (-not (Wait-BackendHealthReady -MaxAttempts 90 -DelayMs 500)) {
    throw "Backend non pret sur /health apres attente. Voir .dev-logs/backend.log"
  }
}

Write-Host "Demarrage frontend Next (processus node, port 3000)..." -ForegroundColor Cyan
Start-FrontendDevProcess
if (-not (Wait-FrontendReady -Port 3000)) {
  Write-Host "Frontend pas encore pret sur :3000 - verifiez .dev-logs/frontend.*.log" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Serveurs lances dans Cursor. Ctrl+C pour arreter." -ForegroundColor Green
Write-Host "Frontend: http://127.0.0.1:3000/briefing" -ForegroundColor Green
Write-Host "          http://127.0.0.1:3000/dashboard" -ForegroundColor Gray
Write-Host "Backend : $healthUrl" -ForegroundColor Gray
if ($Reload) {
  Write-Host "Mode backend : --reload actif (moins stable sous Windows)" -ForegroundColor Yellow
}
else {
  Write-Host "Mode backend : sans --reload (stabilite dev)" -ForegroundColor Gray
}
Write-Host "Watchdog  : health toutes les ${watchdogIntervalSec}s, redemarrage auto apres $watchdogFailThreshold echecs." -ForegroundColor Gray
Write-Host ""

$healthFailStreak = 0
$lastHealthCheckUtc = [datetime]::UtcNow.AddSeconds(-$watchdogIntervalSec)
$lastTunnelCheckUtc = [datetime]::UtcNow.AddSeconds(-$watchdogIntervalSec)

try {
  while ($true) {
    Write-NewLogLines -Path $backendLog -Offset ([ref]$backendLogOffset) -Prefix "[$backendJobName]"

    if ($null -ne $backendProc -and $backendProc.HasExited) {
      $beState = "PID $($backendProc.Id) termine"
      Write-Host "(watchdog) Backend arrete ($beState)." -ForegroundColor Yellow
      $null = Restart-BackendDevProcess -Reason $beState
      $healthFailStreak = 0
    }
    elseif (-not (Test-FrontendProcessRunning)) {
      $feState = if ($null -eq $frontendProc) { "absent" } elseif ($frontendProc.HasExited) { "PID $($frontendProc.Id) termine" } else { "port 3000 libre" }
      Write-Host "(watchdog) Frontend arrete ($feState)." -ForegroundColor Yellow
      $null = Restart-FrontendDevProcess -Reason $feState
    }

    if ($script:MariaDbTunnelEnabled -and $null -ne $script:MariaDbLocalPort) {
      $nowTunnelUtc = [datetime]::UtcNow
      if (($nowTunnelUtc - $lastTunnelCheckUtc).TotalSeconds -ge $watchdogIntervalSec) {
        $lastTunnelCheckUtc = $nowTunnelUtc
        if (-not (Test-MariaDbTunnelListening -Port $script:MariaDbLocalPort)) {
          Write-Host "(watchdog) Tunnel MariaDB port $($script:MariaDbLocalPort) ferme." -ForegroundColor Yellow
          $null = Restart-MariaDbTunnelJob
        }
      }
    }

    $nowUtc = [datetime]::UtcNow
    if (($nowUtc - $lastHealthCheckUtc).TotalSeconds -ge $watchdogIntervalSec) {
      $lastHealthCheckUtc = $nowUtc
      if ($nowUtc -ge $watchdogGraceUntil) {
        if (Test-BackendLiveness -TimeoutSec 10) {
          if ($healthFailStreak -gt 0) {
            Write-Host "(watchdog) Backend live OK." -ForegroundColor DarkGray
          }
          $healthFailStreak = 0
        }
        else {
          $healthFailStreak++
          $portNote = if (Test-BackendPortOpen) { "port ouvert mais /health/live KO" } else { "port 8020 ferme" }
          Write-Host "(watchdog) Backend injoignable ($portNote) - echec $healthFailStreak/$watchdogFailThreshold" -ForegroundColor Yellow
          if ($healthFailStreak -ge $watchdogFailThreshold) {
            if (Restart-BackendDevProcess -Reason $portNote) {
              $healthFailStreak = 0
            }
          }
        }
      }
    }

    Start-Sleep -Milliseconds 700
  }
}
finally {
  Write-Host ""
  Write-Host "Arret des jobs..." -ForegroundColor Yellow
  Stop-BackendDevProcess
  Stop-FrontendDevProcess
  foreach ($n in @($tunnelJobName)) {
    $j = Get-Job -Name $n -ErrorAction SilentlyContinue
    if ($null -ne $j) {
      try { Stop-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
      try { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
}
