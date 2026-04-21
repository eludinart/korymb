#Requires -Version 5.1
<#
.SYNOPSIS
  Vérifie les scripts restart backend / frontend, puis lance les deux dans deux fenêtres PowerShell.

  Depuis PowerShell : .\restart-all.ps1 (préfixe .\ obligatoire dans le dossier du script).

.PARAMETER NoVerify
  Ignore les vérifications (syntaxe, dépendances, smoke test backend).

.PARAMETER NoNewWindows
  Lance backend et frontend dans le terminal courant via des jobs (logs mélangés dans ce terminal après réception).

.PARAMETER VerifyOnly
  Exécute uniquement les vérifications puis quitte (n’ouvre pas de fenêtres, ne lance pas les serveurs).
#>
param(
    [switch] $NoVerify,
    [switch] $NoNewWindows,
    [switch] $VerifyOnly
)

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$backendRestart = Join-Path $backendDir "restart.ps1"
$frontendRestart = Join-Path $rootDir "restart-frontend.ps1"
$thisScript = Join-Path $rootDir "restart-all.ps1"

function Get-ParseErrors {
    param([string] $Path)
    $err = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$err)
    if ($err -and $err.Count -gt 0) { return $err }
    return @()
}

function Stop-ListenersOnPort {
    param([int] $ListenPort)
    for ($round = 1; $round -le 5; $round++) {
        $pids = @(
            Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
        ) | Where-Object { $_ -and $_ -ne 0 } | Select-Object -Unique
        if (-not $pids -or $pids.Count -eq 0) { break }
        foreach ($procId in $pids) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            # Ignore "process not found" races (PID may exit between scan and kill).
            $null = cmd.exe /c "taskkill /F /PID $procId 2>nul 1>nul"
        }
        Start-Sleep -Milliseconds 400
    }
}

function Wait-PortListen {
    param([int] $ListenPort, [int] $TimeoutSec = 45)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $ln = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
        if ($ln) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Stop-JobByNameIfExists {
    param([string] $Name)
    $j = Get-Job -Name $Name -ErrorAction SilentlyContinue
    if ($null -ne $j) {
        try { Stop-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
        try { Remove-Job -Job $j -Force -ErrorAction SilentlyContinue } catch { }
    }
}

function Test-RestartScriptsPhase {
    Write-Host "=== Vérification des scripts restart ===" -ForegroundColor Cyan

    foreach ($pair in @(
            @{ Path = $backendRestart; Name = "backend/restart.ps1" },
            @{ Path = $frontendRestart; Name = "restart-frontend.ps1" },
            @{ Path = $thisScript; Name = "restart-all.ps1" }
        )) {
        if (-not (Test-Path -LiteralPath $pair.Path)) {
            throw "Fichier manquant : $($pair.Name)"
        }
        $parseErrs = Get-ParseErrors -Path $pair.Path
        if ($parseErrs.Count -gt 0) {
            throw "Erreur de syntaxe PowerShell dans $($pair.Name) : $($parseErrs[0].ToString())"
        }
        Write-Host ("  OK syntaxe : {0}" -f $pair.Name) -ForegroundColor Green
    }

    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "python introuvable (requis pour backend/restart.ps1)."
    }
    Write-Host "  OK python" -ForegroundColor Green

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm introuvable (requis pour restart-frontend.ps1)."
    }
    Write-Host "  OK npm" -ForegroundColor Green

    if (-not (Test-Path -LiteralPath (Join-Path $rootDir "package.json"))) {
        throw "package.json introuvable à la racine."
    }
    Write-Host "  OK package.json" -ForegroundColor Green

    # Smoke test : exécuter le script backend réel sur un port éphémère puis /health
    $smokePort = Get-Random -Minimum 58100 -Maximum 58999
    Stop-ListenersOnPort -ListenPort $smokePort
    Write-Host ("  Smoke backend (restart.ps1 -NoReload) sur le port {0}…" -f $smokePort) -ForegroundColor Gray

    $psiArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", $backendRestart,
        "-Port", "$smokePort",
        "-NoReload"
    )
    $pwsh = Start-Process -FilePath "powershell.exe" -WorkingDirectory $backendDir `
        -ArgumentList $psiArgs -PassThru -WindowStyle Hidden

    try {
        if (-not (Wait-PortListen -ListenPort $smokePort -TimeoutSec 50)) {
            throw "Le backend n'a pas ouvert le port $smokePort (timeout). Vérifie les deps Python (pip install -r requirements.txt)."
        }
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:$smokePort/health" -UseBasicParsing -TimeoutSec 10
        if ($health.StatusCode -ne 200) {
            throw "GET /health a retourné $($health.StatusCode)."
        }
        Write-Host "  OK smoke backend : /health HTTP 200" -ForegroundColor Green
    }
    finally {
        Stop-ListenersOnPort -ListenPort $smokePort
        if ($pwsh -and -not $pwsh.HasExited) {
            Stop-Process -Id $pwsh.Id -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 400
    }

    # Vérification légère du script frontend Next : on valide le parse + npm, puis l'utilisateur confirme au premier restart-frontend.
    Write-Host "  OK restart-frontend.ps1 (syntaxe + npm ; pas de démarrage Next dans la phase de test)" -ForegroundColor Green

    Write-Host "=== Toutes les vérifications ont réussi ===" -ForegroundColor Cyan
}

if ($VerifyOnly) {
    if ($NoVerify) {
        throw "-VerifyOnly est incompatible avec -NoVerify."
    }
    Test-RestartScriptsPhase
    Write-Host "VerifyOnly : terminé (aucun serveur lancé)." -ForegroundColor Green
    exit 0
}

if (-not $NoVerify) {
    Test-RestartScriptsPhase
}

if (-not (Test-Path -LiteralPath $backendRestart) -or -not (Test-Path -LiteralPath $frontendRestart)) {
    throw "Scripts restart introuvables."
}

if ($NoNewWindows) {
    Stop-JobByNameIfExists -Name "korymb-backend"
    Stop-JobByNameIfExists -Name "tarot-frontend"
    Write-Host "Démarrage backend (job)…" -ForegroundColor Cyan
    $jobBe = Start-Job -Name "korymb-backend" -ScriptBlock {
        param($scriptPath, $wd)
        Set-Location $wd
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath
    } -ArgumentList $backendRestart, $backendDir

    Write-Host "Démarrage frontend (job)…" -ForegroundColor Cyan
    $jobFe = Start-Job -Name "tarot-frontend" -ScriptBlock {
        param($scriptPath, $wd)
        Set-Location $wd
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath
    } -ArgumentList $frontendRestart, $rootDir

    Write-Host "Jobs démarrés : $($jobBe.Id) (backend), $($jobFe.Id) (frontend)." -ForegroundColor Yellow
    Write-Host "Pour suivre les logs : Receive-Job -Keep -Id $($jobBe.Id) / $($jobFe.Id)" -ForegroundColor Yellow
    Write-Host "Pour arrêter : Stop-Job -Id $($jobBe.Id),$($jobFe.Id); Remove-Job -Id $($jobBe.Id),$($jobFe.Id)" -ForegroundColor Yellow
    return
}

Write-Host "Ouverture de deux fenêtres PowerShell (backend + frontend)…" -ForegroundColor Cyan

Start-Process -FilePath "powershell.exe" -WorkingDirectory $backendDir -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit",
    "-File", $backendRestart
)

Start-Process -FilePath "powershell.exe" -WorkingDirectory $rootDir -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit",
    "-File", $frontendRestart
)

Write-Host "Terminé. Ferme chaque fenêtre pour arrêter le service correspondant." -ForegroundColor Green
