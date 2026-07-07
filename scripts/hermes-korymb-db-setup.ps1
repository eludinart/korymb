#Requires -Version 5.1
<#
.SYNOPSIS
  Configure l'accès lecture seule Hermes → MariaDB Korymb sur le VPS.

.DESCRIPTION
  1. Crée l'utilisateur MariaDB hermes_readonly (SELECT sur la base default).
  2. Ajoute KORYMB_DB_* dans /docker/hermes-agent-aoxw/data/.env
  3. Déploie korymb-sql.sh et la skill korymb-analytics.

  Ne committe aucun secret. Idempotent (réutilisable).

.EXAMPLE
  .\scripts\hermes-korymb-db-setup.ps1
  .\scripts\hermes-korymb-db-setup.ps1 -WhatIf
#>
param(
  [switch] $WhatIf,
  [string] $Target = $(if ($env:KORYMB_VPS_SSH) { $env:KORYMB_VPS_SSH } else { "root@187.124.42.135" }),
  [string] $MariaContainer = "juehpsnqkm60d2o6dhs38c5t",
  [string] $DbName = "default",
  [string] $HermesDir = "/docker/hermes-agent-aoxw"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$SqlScript = Join-Path $RepoRoot "ops\hermes-scripts\korymb-sql.sh"
$SkillDir = Join-Path $RepoRoot "ops\hermes-skills\korymb-analytics"

if (-not (Test-Path $SqlScript)) { throw "Fichier introuvable: $SqlScript" }
if (-not (Test-Path (Join-Path $SkillDir "SKILL.md"))) { throw "Skill introuvable: $SkillDir" }

$remoteSetup = @'
set -euo pipefail
MARIA_CONTAINER="__MARIA__"
DB_NAME="__DB__"
HERMES_DIR="__HERMES__"
HERMES_ENV="$HERMES_DIR/data/.env"
READ_USER="hermes_readonly"

ROOT_PASS="$(docker exec "$MARIA_CONTAINER" printenv MARIADB_ROOT_PASSWORD)"
if [ -z "$ROOT_PASS" ]; then
  echo "Erreur: MARIADB_ROOT_PASSWORD introuvable dans $MARIA_CONTAINER" >&2
  exit 1
fi

# Mot de passe readonly : conserver si déjà présent dans .env Hermes
EXISTING_PASS=""
if [ -f "$HERMES_ENV" ] && grep -q '^KORYMB_DB_PASSWORD=' "$HERMES_ENV"; then
  EXISTING_PASS="$(grep '^KORYMB_DB_PASSWORD=' "$HERMES_ENV" | head -1 | cut -d= -f2- | tr -d '\r')"
fi
if [ -n "$EXISTING_PASS" ]; then
  READ_PASS="$EXISTING_PASS"
  echo "Réutilisation du mot de passe KORYMB_DB_PASSWORD existant."
else
  READ_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  echo "Nouveau mot de passe hermes_readonly généré."
fi

docker exec "$MARIA_CONTAINER" mariadb -uroot -p"$ROOT_PASS" -e "
CREATE USER IF NOT EXISTS '${READ_USER}'@'%' IDENTIFIED BY '${READ_PASS}';
ALTER USER '${READ_USER}'@'%' IDENTIFIED BY '${READ_PASS}';
GRANT SELECT ON \`${DB_NAME}\`.* TO '${READ_USER}'@'%';
FLUSH PRIVILEGES;
"

# Test lecture
docker exec "$MARIA_CONTAINER" mariadb -u"$READ_USER" -p"$READ_PASS" "$DB_NAME" -e "SELECT COUNT(*) AS tables_ok FROM information_schema.tables WHERE table_schema='${DB_NAME}';"

touch "$HERMES_ENV"
grep -v '^KORYMB_DB_' "$HERMES_ENV" > "${HERMES_ENV}.tmp" || true
cat >> "${HERMES_ENV}.tmp" <<EOF
KORYMB_DB_HOST=${MARIA_CONTAINER}
KORYMB_DB_PORT=3306
KORYMB_DB_NAME=${DB_NAME}
KORYMB_DB_USER=${READ_USER}
KORYMB_DB_PASSWORD=${READ_PASS}
KORYMB_DB_CONTAINER=${MARIA_CONTAINER}
KORYMB_DB_ENGINE=mariadb
EOF
mv "${HERMES_ENV}.tmp" "$HERMES_ENV"
chmod 600 "$HERMES_ENV"

mkdir -p "$HERMES_DIR/data/scripts" "$HERMES_DIR/data/skills/korymb-analytics"
echo "OK: .env et répertoires Hermes prêts."
'@

$remoteSetup = $remoteSetup.Replace("__MARIA__", $MariaContainer).Replace("__DB__", $DbName).Replace("__HERMES__", $HermesDir)

Write-Host "=== Hermes → Korymb MariaDB (lecture seule) ===" -ForegroundColor Cyan
Write-Host "  VPS      : $Target"
Write-Host "  MariaDB  : $MariaContainer / $DbName"
Write-Host ""

if ($WhatIf) {
  Write-Host "[WhatIf] Exécuterait setup distant + copie script/skill." -ForegroundColor Yellow
  exit 0
}

$remoteSetup | ssh -o BatchMode=yes -o ConnectTimeout=20 $Target "bash -s"

scp -o BatchMode=yes $SqlScript "${Target}:${HermesDir}/data/scripts/korymb-sql.sh"
scp -o BatchMode=yes (Join-Path $SkillDir "SKILL.md") "${Target}:${HermesDir}/data/skills/korymb-analytics/SKILL.md"

ssh -o BatchMode=yes $Target "chmod +x ${HermesDir}/data/scripts/korymb-sql.sh && docker exec hermes-agent-aoxw-hermes-agent-1 bash -lc 'chmod +x /opt/data/scripts/korymb-sql.sh 2>/dev/null || true'"

Write-Host "`n=== Test requête depuis Hermes ===" -ForegroundColor Cyan
ssh -o BatchMode=yes $Target @'
docker exec hermes-agent-aoxw-hermes-agent-1 /opt/data/scripts/korymb-sql.sh "SELECT COUNT(*) AS n FROM korymb_workspaces LIMIT 1"
'@

Write-Host "`nTermine. Skill: korymb-analytics - Doc: docs/HERMES-KORYMB-DATABASE.md" -ForegroundColor Green
