#Requires -Version 5.1
<#
.SYNOPSIS
  Configure l'accès lecture seule Hermes → MariaDB Fleur d'ÅmÔurs sur le VPS.

.DESCRIPTION
  1. Crée l'utilisateur MariaDB hermes_fleur_readonly (SELECT sur la base default).
  2. Ajoute FLEUR_DB_* dans /docker/hermes-agent-aoxw/data/.env
  3. Déploie fleur-sql.sh et la skill fleur-analytics.

  Ne committe aucun secret. Idempotent (réutilisable).

.EXAMPLE
  .\scripts\hermes-fleur-db-setup.ps1
  .\scripts\hermes-fleur-db-setup.ps1 -WhatIf
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
$SqlScript = Join-Path $RepoRoot "ops\hermes-scripts\fleur-sql.sh"
$SkillDir = Join-Path $RepoRoot "ops\hermes-skills\fleur-analytics"
$EcosystemSkill = Join-Path $RepoRoot "ops\hermes-skills\eludein-ecosystem\SKILL.md"

if (-not (Test-Path $SqlScript)) { throw "Fichier introuvable: $SqlScript" }
if (-not (Test-Path (Join-Path $SkillDir "SKILL.md"))) { throw "Skill introuvable: $SkillDir" }

$remoteSetup = @'
set -euo pipefail
MARIA_CONTAINER="__MARIA__"
DB_NAME="__DB__"
HERMES_DIR="__HERMES__"
HERMES_ENV="$HERMES_DIR/data/.env"
READ_USER="hermes_fleur_readonly"

ROOT_PASS="$(docker exec "$MARIA_CONTAINER" printenv MARIADB_ROOT_PASSWORD)"
if [ -z "$ROOT_PASS" ]; then
  echo "Erreur: MARIADB_ROOT_PASSWORD introuvable dans $MARIA_CONTAINER" >&2
  exit 1
fi

EXISTING_PASS=""
if [ -f "$HERMES_ENV" ] && grep -q '^FLEUR_DB_PASSWORD=' "$HERMES_ENV"; then
  EXISTING_PASS="$(grep '^FLEUR_DB_PASSWORD=' "$HERMES_ENV" | head -1 | cut -d= -f2- | tr -d '\r')"
fi
if [ -n "$EXISTING_PASS" ]; then
  READ_PASS="$EXISTING_PASS"
  echo "Reutilisation du mot de passe FLEUR_DB_PASSWORD existant."
else
  READ_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  echo "Nouveau mot de passe hermes_fleur_readonly genere."
fi

docker exec "$MARIA_CONTAINER" mariadb -uroot -p"$ROOT_PASS" -e "
CREATE USER IF NOT EXISTS '${READ_USER}'@'%' IDENTIFIED BY '${READ_PASS}';
ALTER USER '${READ_USER}'@'%' IDENTIFIED BY '${READ_PASS}';
GRANT SELECT ON \`${DB_NAME}\`.* TO '${READ_USER}'@'%';
FLUSH PRIVILEGES;
"

docker exec "$MARIA_CONTAINER" mariadb -u"$READ_USER" -p"$READ_PASS" "$DB_NAME" -e "
SELECT COUNT(*) AS fleur_tables FROM information_schema.tables
WHERE table_schema='${DB_NAME}' AND table_name LIKE 'wp_fleur_%';
"

touch "$HERMES_ENV"
grep -v '^FLEUR_DB_' "$HERMES_ENV" > "${HERMES_ENV}.tmp" || true
cat >> "${HERMES_ENV}.tmp" <<EOF
FLEUR_DB_HOST=${MARIA_CONTAINER}
FLEUR_DB_PORT=3306
FLEUR_DB_NAME=${DB_NAME}
FLEUR_DB_USER=${READ_USER}
FLEUR_DB_PASSWORD=${READ_PASS}
FLEUR_DB_CONTAINER=${MARIA_CONTAINER}
FLEUR_DB_ENGINE=mariadb
FLEUR_DB_APP_URL=https://app-fleurdamours.eludein.art
EOF
mv "${HERMES_ENV}.tmp" "$HERMES_ENV"
chmod 600 "$HERMES_ENV"
chown 10000:10000 "$HERMES_ENV" 2>/dev/null || true

mkdir -p "$HERMES_DIR/data/scripts" "$HERMES_DIR/data/skills/fleur-analytics" "$HERMES_DIR/data/skills/eludein-ecosystem"
echo "OK: .env et repertoires Hermes prets."
'@

$remoteSetup = $remoteSetup.Replace("__MARIA__", $MariaContainer).Replace("__DB__", $DbName).Replace("__HERMES__", $HermesDir)

Write-Host "=== Hermes -> Fleur d'Amours MariaDB (lecture seule) ===" -ForegroundColor Cyan
Write-Host "  VPS      : $Target"
Write-Host "  MariaDB  : $MariaContainer / $DbName"
Write-Host ""

if ($WhatIf) {
  Write-Host "[WhatIf] Executerait setup distant + copie script/skill." -ForegroundColor Yellow
  exit 0
}

$remoteSetup | ssh -o BatchMode=yes -o ConnectTimeout=20 $Target "bash -s"

scp -o BatchMode=yes $SqlScript "${Target}:${HermesDir}/data/scripts/fleur-sql.sh"
scp -o BatchMode=yes (Join-Path $SkillDir "SKILL.md") "${Target}:${HermesDir}/data/skills/fleur-analytics/SKILL.md"
if (Test-Path $EcosystemSkill) {
  scp -o BatchMode=yes $EcosystemSkill "${Target}:${HermesDir}/data/skills/eludein-ecosystem/SKILL.md"
}

ssh -o BatchMode=yes $Target "chmod +x ${HermesDir}/data/scripts/fleur-sql.sh && docker exec hermes-agent-aoxw-hermes-agent-1 bash -lc 'chmod +x /opt/data/scripts/fleur-sql.sh 2>/dev/null || true'"

Write-Host "`n=== Test requete depuis Hermes ===" -ForegroundColor Cyan
ssh -o BatchMode=yes $Target @'
docker exec hermes-agent-aoxw-hermes-agent-1 /opt/data/scripts/fleur-sql.sh "SELECT COUNT(*) AS fleur_tables FROM information_schema.tables WHERE table_schema='default' AND table_name LIKE 'wp_fleur_%'"
'@

Write-Host "`nTermine. Skill: fleur-analytics - Doc: docs/HERMES-FLEUR-DATABASE.md" -ForegroundColor Green
