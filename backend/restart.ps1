#Requires -Version 5.1
<#
.SYNOPSIS
  Arrête proprement tout uvicorn / main:app sur le port, attend que le port soit libre, puis relance uvicorn.

  Durcit le cas Windows (plusieurs LISTEN, PID fantomes, --reload) : taskkill /T, attente jusqu’à 90 s,
  mutex Local\KorymbBackendRestart-<port> pour éviter deux restart.ps1 en parallèle sur le même port.

  Depuis PowerShell : .\restart.ps1 (le répertoire courant n’est pas dans le PATH des scripts).

.PARAMETER Port
  Port d'écoute. Si 0 : $env:UVICORN_PORT, puis VITE_PROXY_TARGET dans .env (racine ou local), sinon 8002.

.PARAMETER BindHost
  Adresse d'écoute (défaut 127.0.0.1). Ne pas utiliser le nom Host (réservé PowerShell).

.PARAMETER NoReload
  Désactive --reload (plus proche de la prod).
#>
param(
    [int] $Port = 0,
    [string] $BindHost = "127.0.0.1",
    [switch] $NoReload
)

$ErrorActionPreference = "Stop"
$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $backendDir

function Invoke-TaskKillSilent {
    param([int] $ProcessId)
    # taskkill sur stderr avec Stop declenche une erreur PowerShell ; cmd absorbe la sortie.
    $null = cmd.exe /c "taskkill /F /PID $ProcessId 2>nul 1>nul"
}

function Invoke-TaskKillTreeSilent {
    param([int] $ProcessId)
    # /T : enfants (reloader uvicorn, workers) pour eviter LISTEN fantomes et doubles instances.
    $null = cmd.exe /c "taskkill /F /PID $ProcessId /T 2>nul 1>nul"
}

function Get-ListenPidsOnPort {
    param([int] $ListenPort)
    @(
        Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    ) | Where-Object { $_ -and $_ -ne 0 } | Select-Object -Unique
}

function Test-LocalTcpPortBindable {
    param([int] $Port, [string] $BindHost = "127.0.0.1")
    # Sous Windows : ecoute sur ::1 vs 127.0.0.1 ; tester les deux quand l hote prevu est IPv4 loopback.
    $candidates = New-Object "System.Collections.Generic.List[System.Net.IPAddress]"
    try {
        $null = $candidates.Add([System.Net.IPAddress]::Parse($BindHost))
    }
    catch {
        $null = $candidates.Add([System.Net.IPAddress]::Loopback)
    }
    if ($BindHost -eq "127.0.0.1") {
        $v6 = [System.Net.IPAddress]::IPv6Loopback
        $hasV6 = $false
        foreach ($x in $candidates) {
            if ($x.Equals($v6)) { $hasV6 = $true }
        }
        if (-not $hasV6) { $null = $candidates.Add($v6) }
    }
    foreach ($addr in $candidates) {
        $listener = $null
        try {
            $listener = [System.Net.Sockets.TcpListener]::new($addr, $Port)
            $listener.Start()
            return $true
        }
        catch { }
        finally {
            if ($null -ne $listener) {
                try { $listener.Stop() } catch { }
            }
        }
    }
    return $false
}

function Stop-UvicornProcessesForPort {
    param([int] $ListenPort)
    # Windows : plusieurs LISTEN, PID fantomes, parent + enfant uvicorn --reload.
    # Toute ligne avec --port <n> et (uvicorn OU main:app) = backend Korymb typique.
    $portEsc = [regex]::Escape([string]$ListenPort)
    $portRx = [regex]::new(('(?i)--port=?\s*' + $portEsc + '(?:\s|$)'))
    try {
        $hits = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $cl = $_.CommandLine
                if (-not $cl) { return $false }
                if (-not $portRx.IsMatch($cl)) { return $false }
                if ($cl -match '(?i)uvicorn') { return $true }
                if ($cl -match 'main:app') { return $true }
                return $false
            })
        foreach ($h in $hits) {
            $winPid = [int]$h.ProcessId
            if ($winPid -le 0) { continue }
            Write-Host ("Arret arbre PID {0} (uvicorn/main:app sur port {1})..." -f $winPid, $ListenPort)
            Invoke-TaskKillTreeSilent -ProcessId $winPid
            Stop-Process -Id $winPid -Force -ErrorAction SilentlyContinue
        }
    }
    catch { }
}

function Wait-BackendPortFreed {
    param([int] $ListenPort, [int] $MaxWaitSec = 90, [string] $BindHost = "127.0.0.1")
    $deadline = [datetime]::UtcNow.AddSeconds($MaxWaitSec)
    $round = 0
    $ghostStreak = 0
    while ([datetime]::UtcNow -lt $deadline) {
        $pids = @(Get-ListenPidsOnPort -ListenPort $ListenPort)
        if ($pids.Count -eq 0) {
            return $true
        }

        $allGhost = $true
        foreach ($xpid in $pids) {
            if (Get-Process -Id $xpid -ErrorAction SilentlyContinue) {
                $allGhost = $false
                break
            }
        }
        if (-not $allGhost) {
            $ghostStreak = 0
        }
        else {
            $ghostStreak++
        }

        if ($allGhost -and (Test-LocalTcpPortBindable -Port $ListenPort -BindHost $BindHost)) {
            Write-Host (
                "Port {0} : LISTEN fantome (PIDs {1} inexistants) mais bind reussi - le port est utilisable." -f $ListenPort, ($pids -join ", ")
            ) -ForegroundColor Yellow
            return $true
        }

        # TCP table Windows : PID fantome + bind KO en boucle : on laisse uvicorn tenter (souvent OK).
        if ($allGhost -and $ghostStreak -ge 10) {
            Write-Host (
                "Port {0} : seulement des PIDs fantomes ({1}) et bind incertain apres {2} passes - poursuite du demarrage uvicorn." -f $ListenPort, ($pids -join ", "), $ghostStreak
            ) -ForegroundColor Yellow
            return $true
        }

        $round++
        if ($round -eq 1 -or ($round % 6) -eq 0) {
            Write-Host ("Port {0} encore en ecoute - PIDs : {1} (arret cible, passe {2})..." -f $ListenPort, ($pids -join ", "), $round)
            Stop-UvicornProcessesForPort -ListenPort $ListenPort
            Stop-ListenersOnPort -ListenPort $ListenPort
        }
        Start-Sleep -Milliseconds 450
    }
    return $false
}

function Read-PortFromEnvFiles {
    $repoRoot = Split-Path -Parent $backendDir
    $paths = @(
        (Join-Path $repoRoot ".env"),
        (Join-Path $repoRoot ".env.local"),
        (Join-Path $backendDir ".env")
    )
    foreach ($p in $paths) {
        if (-not (Test-Path -LiteralPath $p)) { continue }
        foreach ($line in Get-Content -LiteralPath $p -Encoding utf8 -ErrorAction SilentlyContinue) {
            if ($line -match '^\s*UVICORN_PORT\s*=\s*(\d+)\s*$') { return [int]$Matches[1] }
            if ($line -match '^\s*VITE_PROXY_TARGET\s*=\s*https?://[^:]+:\s*(\d+)') { return [int]$Matches[1] }
        }
    }
    return $null
}

function Resolve-Port {
    param([int] $Explicit)
    if ($Explicit -gt 0) { return $Explicit }
    $e = $env:UVICORN_PORT
    if ($e -match '^\d+$') { return [int]$e }
    $fromFile = Read-PortFromEnvFiles
    if ($null -ne $fromFile) { return $fromFile }
    return 8002
}

function Stop-ListenersOnPort {
    param([int] $ListenPort)
    # Plusieurs passes : plusieurs uvicorn --reload peuvent laisser plusieurs LISTEN sur le meme port.
    # Get-NetTCPConnection peut encore annoncer un OwningProcess apres la fin du processus (PID fantome) :
    # ne pas boucler 6 fois sur le meme PID absent (spam d avertissements).
    for ($round = 1; $round -le 5; $round++) {
        $pids = @(
            Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
        ) | Where-Object { $_ -and $_ -ne 0 } | Select-Object -Unique

        if (-not $pids -or $pids.Count -eq 0) { break }

        $alive = @($pids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        if ($alive.Count -eq 0) {
            foreach ($procId in $pids) {
                Invoke-TaskKillSilent -ProcessId $procId
            }
            $ghostMsg = "Port {0} : PID(s) {1} absents du gestionnaire (TCP residuel) - pas d arret force utile. On continue." -f $ListenPort, ($pids -join ", ")
            Write-Host $ghostMsg -ForegroundColor DarkGray
            break
        }

        foreach ($procId in $alive) {
            try {
                $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
                Write-Host ("Arret arbre PID {0} ({1})..." -f $procId, $p.ProcessName)
                Invoke-TaskKillTreeSilent -ProcessId $procId
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                Invoke-TaskKillSilent -ProcessId $procId
            }
            catch {
                Write-Warning ("Impossible d arreter PID {0} : {1}" -f $procId, $_)
                Invoke-TaskKillTreeSilent -ProcessId $procId
                Invoke-TaskKillSilent -ProcessId $procId
            }
        }
        Start-Sleep -Milliseconds 500
    }

    $still = @(
        Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    ) | Where-Object { $_ -and $_ -ne 0 } | Select-Object -Unique
    $stillAlive = @($still | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($stillAlive.Count -gt 0) {
        Write-Warning (
            "Des processus vivants ecoutent encore sur le port $ListenPort (PIDs : $($stillAlive -join ', ')). " +
            "Ferme les fenetres uvicorn ou : Stop-Process -Id $($stillAlive[0]) -Force"
        )
    }
    elseif ($still.Count -gt 0) {
        $noteMsg = "Note : le port {0} figure encore comme LISTEN (PID {1}) sans processus - souvent resorbe en quelques secondes sous Windows." -f $ListenPort, ($still -join ", ")
        Write-Host $noteMsg -ForegroundColor DarkGray
    }
}

$Port = Resolve-Port -Explicit $Port

Write-Host ("Repertoire backend : {0}" -f $backendDir)
Write-Host ("Port : {0}" -f $Port)
try {
    $verOut = (& python -c "import version; print(version.BACKEND_VERSION); print(version.__file__)" 2>$null | Out-String).Trim()
    if ($verOut) {
        $lines = @($verOut -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        if ($lines.Count -ge 1) { Write-Host ("Build backend (BACKEND_VERSION) : {0}" -f $lines[0]) }
        if ($lines.Count -ge 2) { Write-Host ("Fichier version.py charge : {0}" -f $lines[1]) -ForegroundColor DarkGray }
    }
} catch { }

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Write-Error "python introuvable dans le PATH. Active ton venv ou installe Python."
    exit 1
}

# Verrou : empeche deux restart.ps1 en parallele sur le meme port (courses + doubles LISTEN).
$mutexName = "Local\KorymbBackendRestart-$Port"
$mtx = $null
try {
    $mtx = New-Object System.Threading.Mutex($false, $mutexName)
}
catch {
    Write-Error "Impossible de creer le mutex $mutexName : $_"
    exit 1
}

try {
    if (-not $mtx.WaitOne([TimeSpan]::FromMinutes(12))) {
        Write-Error "Un autre restart.ps1 occupe deja le port $Port (verrou 12 min). Ferme l'autre fenetre ou attends."
        exit 1
    }
    Write-Host ("Verrou acquis ({0}) - aucun autre restart simultane sur ce port." -f $mutexName) -ForegroundColor DarkGray

    Write-Host "Arret des processus uvicorn / main:app sur ce port (ligne de commande)..."
    Stop-UvicornProcessesForPort -ListenPort $Port
    Write-Host "Liberation du port (listeners TCP, plusieurs passes)..."
    Stop-ListenersOnPort -ListenPort $Port
    Start-Sleep -Milliseconds 600

    if (-not (Wait-BackendPortFreed -ListenPort $Port -MaxWaitSec 90 -BindHost $BindHost)) {
        Write-Error (
            "Le port $Port ne s'est pas libere apres 90 s (bind $BindHost impossible). " +
            "Diagnostic : netstat -ano | findstr LISTENING (chercher :$Port). " +
            "Si PID fantome sans processus : redemarrer Windows ou attendre la fin du TIME_WAIT. " +
            "Sinon : ferme les PID python/uvicorn, puis relance .\restart.ps1"
        )
        exit 1
    }

    # --app-dir : même si le script est lancé sans WorkingDirectory correct, Python charge
    # toujours `main` / `version` depuis ce dossier (sinon un autre `main.py` sur le PATH peut répondre en 3.0.0).
    if ($NoReload) {
        $uvArgs = @(
            "-m", "uvicorn", "main:app",
            "--app-dir", $backendDir,
            "--host", $BindHost, "--port", "$Port"
        )
    }
    else {
        $uvArgs = @(
            "-m", "uvicorn", "main:app",
            "--app-dir", $backendDir,
            "--reload", "--host", $BindHost, "--port", "$Port"
        )
    }

    Write-Host ("Lancement : python {0}" -f ($uvArgs -join " "))
    & python @uvArgs
}
finally {
    if ($null -ne $mtx) {
        try { [void]$mtx.ReleaseMutex() } catch { }
        try { $mtx.Dispose() } catch { }
    }
}
