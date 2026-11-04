#Requires -Version 5.1
<#
.SYNOPSIS
  Client HTTP Korymb (agent secret) — health, bus, admin lecture.
.EXAMPLE
  .\scripts\korymb-api.ps1 -Method GET -Path /health
  .\scripts\korymb-api.ps1 -Method GET -Path "/agent-bus/messages?to=cursor&status=open"
  .\scripts\korymb-api.ps1 -Method POST -Path /agent-bus/messages -Body @{ from="cursor"; to="grokbot"; topic="cursor-remind"; body="Rappel: revoir le plan Mandala" }
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("GET", "POST", "PATCH", "DELETE", "HEAD")]
  [string] $Method,

  [Parameter(Mandatory = $true)]
  [string] $Path,

  [object] $Body = $null,

  [string] $BaseUrl = $(if ($env:KORYMB_API_URL) { $env:KORYMB_API_URL } else { "https://api-korymb.eludein.art" }),

  [string] $WorkspaceId = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Read-DotEnvValue([string]$FilePath, [string]$Key) {
  if (-not (Test-Path $FilePath)) { return $null }
  foreach ($line in Get-Content $FilePath -ErrorAction SilentlyContinue) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $k, $v = $line.Split("=", 2)
    if ($k.Trim() -eq $Key) {
      return $v.Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

$secret = $env:KORYMB_AGENT_SECRET
if (-not $secret) { $secret = $env:AGENT_API_SECRET }
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
  $secret = Read-DotEnvValue (Join-Path $RepoRoot ".env") "KORYMB_AGENT_SECRET"
}
if (-not $secret) {
  throw "Secret manquant : KORYMB_AGENT_SECRET ou AGENT_API_SECRET (env / backend/.env)."
}

$pathPart = $Path.Trim()
if (-not $pathPart.StartsWith("/")) { $pathPart = "/" + $pathPart }

$url = ($BaseUrl.TrimEnd("/")) + $pathPart
$headers = @{
  "X-Agent-Secret" = $secret
  "Accept"         = "application/json"
}
if ($WorkspaceId) {
  $headers["X-Workspace-Id"] = $WorkspaceId
}

$invokeParams = @{
  Method  = $Method
  Uri     = $url
  Headers = $headers
}

if ($null -ne $Body -and $Method -ne "GET" -and $Method -ne "HEAD") {
  if ($Body -is [string]) {
    $json = $Body
  } else {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
  }
  $invokeParams["ContentType"] = "application/json; charset=utf-8"
  $invokeParams["Body"] = [System.Text.Encoding]::UTF8.GetBytes($json)
}

Write-Host "$Method $pathPart" -ForegroundColor Cyan
try {
  $res = Invoke-RestMethod @invokeParams
} catch {
  $err = $_
  $msg = $err.ErrorDetails.Message
  if (-not $msg) { $msg = $err.Exception.Message }
  Write-Host $msg -ForegroundColor Red
  throw $err
}

$res | ConvertTo-Json -Depth 10
