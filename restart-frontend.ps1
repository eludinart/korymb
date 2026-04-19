#Requires -Version 5.1
<#
.SYNOPSIS
  Libère le port du serveur Vite puis lance `npm run dev` (racine du dépôt).

  Depuis PowerShell : toujours préfixer par .\ (ex. .\restart-frontend.ps1) si tu es dans ce dossier.

.PARAMETER Port
  Port dev Vite. Si 0 : $env:VITE_DEV_PORT, puis VITE_DEV_PORT dans .env / .env.local, sinon 4000 (comme vite.config.js).
#>
param(
    [int] $Port = 0
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $rootDir

if (-not (Test-Path -LiteralPath (Join-Path $rootDir "package.json"))) {
    Write-Error "package.json introuvable. Ce script doit rester à la racine du dépôt (tarot.app)."
    exit 1
}

function Read-ViteDevPortFromEnvFiles {
    foreach ($name in @(".env", ".env.local")) {
        $p = Join-Path $rootDir $name
        if (-not (Test-Path -LiteralPath $p)) { continue }
        foreach ($line in Get-Content -LiteralPath $p -Encoding utf8 -ErrorAction SilentlyContinue) {
            if ($line -match '^\s*VITE_DEV_PORT\s*=\s*(\d+)\s*$') { return [int]$Matches[1] }
        }
    }
    return $null
}

function Resolve-DevPort {
    param([int] $Explicit)
    if ($Explicit -gt 0) { return $Explicit }
    $e = $env:VITE_DEV_PORT
    if ($e -match '^\d+$') { return [int]$e }
    $fromFile = Read-ViteDevPortFromEnvFiles
    if ($null -ne $fromFile) { return $fromFile }
    return 4000
}

function Stop-ListenersOnPort {
    param([int] $ListenPort)
    $pids = @(
        Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    ) | Where-Object { $_ -and $_ -ne 0 } | Select-Object -Unique

    foreach ($procId in $pids) {
        try {
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if (-not $p) { continue }
            Write-Host ("Arret PID {0} ({1})..." -f $procId, $p.ProcessName)
            Stop-Process -Id $procId -Force -ErrorAction Stop
        }
        catch {
            Write-Warning ("Impossible d arreter PID {0} : {1}" -f $procId, $_)
        }
    }
}

$Port = Resolve-DevPort -Explicit $Port

Write-Host ("Repertoire frontend : {0}" -f $rootDir)
Write-Host ("Port Vite : {0}" -f $Port)

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Error "npm introuvable dans le PATH. Installe Node.js ou ouvre un terminal où npm est disponible."
    exit 1
}

Write-Host "Liberation du port (processus en ecoute)..."
Stop-ListenersOnPort -ListenPort $Port
Start-Sleep -Milliseconds 500

Write-Host "Lancement : npm run dev"
$env:VITE_DEV_PORT = "$Port"
& npm run dev
