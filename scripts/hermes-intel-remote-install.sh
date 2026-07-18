#!/usr/bin/env bash
set -euo pipefail
HERMES_DIR=/docker/hermes-agent-aoxw
cd /tmp
rm -rf hermes-deploy
mkdir hermes-deploy
tar -xzf hermes-intel.tgz -C hermes-deploy

cp hermes-deploy/hermes/SOUL.md "$HERMES_DIR/data/SOUL.md"
mkdir -p "$HERMES_DIR/data/memories"
cp hermes-deploy/hermes/memories/*.md "$HERMES_DIR/data/memories/"

for sk in hermes-deploy/hermes-skills/*/; do
  name=$(basename "$sk")
  mkdir -p "$HERMES_DIR/data/skills/$name"
  cp "$sk/SKILL.md" "$HERMES_DIR/data/skills/$name/"
done

cp hermes-deploy/hermes-scripts/*.sh "$HERMES_DIR/data/scripts/"
mkdir -p /opt/data/scripts
for s in korymb-sql.sh fleur-sql.sh eludein-db-check.sh eludein-sql.sh korymb-api.sh eludein-telegram-send.sh eludein-morning-briefing.sh eludein-evening-recap.sh eludein-alerts.sh eludein-post-deploy-smoke.sh eludein-log-watch.sh; do
  if [ -f "hermes-deploy/hermes-scripts/host/$s" ]; then
    cp "hermes-deploy/hermes-scripts/host/$s" "/opt/data/scripts/$s"
  else
    cp "hermes-deploy/hermes-scripts/$s" "/opt/data/scripts/$s"
  fi
done

chmod +x "$HERMES_DIR/data/scripts/"*.sh /opt/data/scripts/*.sh
ln -sf "$HERMES_DIR/data/.env" /opt/data/.env
for name in livrables sources travail rep_tech_hermes; do
  mkdir -p "$HERMES_DIR/data/$name"
  rm -rf "/opt/data/$name" 2>/dev/null || true
  ln -sf "$HERMES_DIR/data/$name" "/opt/data/$name"
done
touch /var/log/eludein-briefing.log /var/log/eludein-recap.log /var/log/eludein-alerts.log /var/log/eludein-smoke.log /var/log/eludein-logwatch.log

echo "Skills count:" $(ls -1 "$HERMES_DIR/data/skills/" | wc -l)
test -f "$HERMES_DIR/data/memories/decisions-eric.md" && echo "decisions-eric.md OK"
/opt/data/scripts/eludein-db-check.sh
