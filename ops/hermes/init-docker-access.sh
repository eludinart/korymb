#!/bin/bash
# Référence VPS : /docker/hermes-agent-aoxw/init-docker-access.sh
# Monté dans le conteneur Hermes ; exécuté avant /entrypoint.sh
set -e
if ! getent group docker >/dev/null 2>&1; then
  groupadd -g 988 docker
fi
usermod -aG docker hermes

# Éditions host en root → data/.env illisible pour hermes (UID 10000)
if [ -f /opt/data/.env ]; then
  chown hermes:hermes /opt/data/.env
  chmod 600 /opt/data/.env
fi

exec /entrypoint.sh
