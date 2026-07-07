#Requires -Version 5.1
<#
.SYNOPSIS
  Ouvre une session SSH interactive vers le VPS eludein (Korymb + Hermes).

.DESCRIPTION
  Utilise $env:KORYMB_VPS_SSH ou root@187.124.42.135 par défaut.
  Voir docs/ADMINISTRATION.md pour l'inventaire complet.

.EXAMPLE
  .\scripts\vps-ssh.ps1
#>
param(
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [string[]] $RemoteCommand
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  throw "Client OpenSSH introuvable. Installez-le via Paramètres Windows > Fonctionnalités facultatives."
}

Write-Host "Connexion SSH → $Target" -ForegroundColor Cyan
Write-Host "Doc ops : docs/ADMINISTRATION.md" -ForegroundColor Gray
Write-Host ""

if ($RemoteCommand -and $RemoteCommand.Count -gt 0) {
  & ssh $Target @RemoteCommand
}
else {
  & ssh $Target
}
