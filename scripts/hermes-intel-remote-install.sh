#!/usr/bin/env bash
set -euo pipefail
HERMES_DIR=/docker/hermes-agent-aoxw
cd /tmp
rm -rf hermes-deploy
mkdir hermes-deploy
tar -xzf hermes-intel.tgz -C hermes-deploy

# Normaliser CRLF éventuel (Windows)
find hermes-deploy -type f \( -name '*.sh' -o -name 'skills-allowlist.txt' \) -print0 \
  | xargs -0 -r sed -i 's/\r$//' || true

cp hermes-deploy/hermes/SOUL.md "$HERMES_DIR/data/SOUL.md"
mkdir -p "$HERMES_DIR/data/memories"
cp hermes-deploy/hermes/memories/*.md "$HERMES_DIR/data/memories/"

ALLOWLIST_FILE="hermes-deploy/hermes/skills-allowlist.txt"
if [[ -f "$ALLOWLIST_FILE" ]]; then
  mapfile -t ALLOW < <(grep -E '^[a-zA-Z0-9_-]+$' "$ALLOWLIST_FILE" || true)
else
  ALLOW=()
fi

mkdir -p "$HERMES_DIR/data/skills"
if [[ ${#ALLOW[@]} -gt 0 ]]; then
  for name in "${ALLOW[@]}"; do
    src="hermes-deploy/hermes-skills/$name"
    if [[ -d "$src" && -f "$src/SKILL.md" ]]; then
      mkdir -p "$HERMES_DIR/data/skills/$name"
      cp "$src/SKILL.md" "$HERMES_DIR/data/skills/$name/"
    else
      echo "WARN: skill absente du tar: $name" >&2
    fi
  done
  # Retirer les skills Élude connues hors allowlist (ne pas toucher skills tiers inconnues)
  KNOWN_ELUDE=(
    eludein-ops-rules eludein-ecosystem eludein-daily-briefing eludein-second-cerveau
    eludein-agent-bus eludein-backup-checklist eludein-content-radar eludein-log-watcher
    korymb-api-bridge korymb-inbox-triage korymb-analytics korymb-mapping
    fleur-analytics fleur-growth-snapshot fleur-damours-publication-automatisee
    coolify-services-map coolify-deploy-checklist coolify-admin
    hermes-vps-health hermes-db-analysis hermes-deploy-check eludein
  )
  for name in "${KNOWN_ELUDE[@]}"; do
    keep=0
    for a in "${ALLOW[@]}"; do
      if [[ "$a" == "$name" ]]; then keep=1; break; fi
    done
    if [[ $keep -eq 0 && -d "$HERMES_DIR/data/skills/$name" ]]; then
      rm -rf "$HERMES_DIR/data/skills/$name"
      echo "removed skill: $name"
    fi
  done
else
  for sk in hermes-deploy/hermes-skills/*/; do
    name=$(basename "$sk")
    mkdir -p "$HERMES_DIR/data/skills/$name"
    cp "$sk/SKILL.md" "$HERMES_DIR/data/skills/$name/"
  done
fi

cp hermes-deploy/hermes-scripts/*.sh "$HERMES_DIR/data/scripts/" 2>/dev/null || true
mkdir -p /opt/data/scripts
for s in korymb-sql.sh fleur-sql.sh eludein-db-check.sh eludein-sql.sh korymb-api.sh eludein-telegram-send.sh eludein-morning-briefing.sh eludein-evening-recap.sh eludein-alerts.sh eludein-post-deploy-smoke.sh eludein-log-watch.sh; do
  if [ -f "hermes-deploy/hermes-scripts/host/$s" ]; then
    cp "hermes-deploy/hermes-scripts/host/$s" "/opt/data/scripts/$s"
  elif [ -f "hermes-deploy/hermes-scripts/$s" ]; then
    cp "hermes-deploy/hermes-scripts/$s" "/opt/data/scripts/$s"
  fi
done

# LF sur scripts runtime
sed -i 's/\r$//' "$HERMES_DIR/data/scripts/"*.sh /opt/data/scripts/*.sh 2>/dev/null || true
chmod +x "$HERMES_DIR/data/scripts/"*.sh /opt/data/scripts/*.sh 2>/dev/null || true
ln -sf "$HERMES_DIR/data/.env" /opt/data/.env
for name in livrables sources travail rep_tech_hermes; do
  mkdir -p "$HERMES_DIR/data/$name"
  rm -rf "/opt/data/$name" 2>/dev/null || true
  ln -sf "$HERMES_DIR/data/$name" "/opt/data/$name"
done
touch /var/log/eludein-briefing.log /var/log/eludein-recap.log /var/log/eludein-alerts.log /var/log/eludein-smoke.log /var/log/eludein-logwatch.log

echo "Skills count:" $(ls -1 "$HERMES_DIR/data/skills/" | wc -l)
echo "Allowlist:" "${ALLOW[*]:-all}"
test -f "$HERMES_DIR/data/memories/decisions-eric.md" && echo "decisions-eric.md OK"
/opt/data/scripts/eludein-db-check.sh || true
