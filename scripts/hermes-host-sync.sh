#!/usr/bin/env bash
# Synchronise /opt/data hôte (SSH Hermes + crons) vers le volume agent.
set -euo pipefail

VOL="/docker/hermes-agent-aoxw/data"
HOST="/opt/data"

[ -d "$VOL" ] || { echo "Volume introuvable: $VOL"; exit 1; }
mkdir -p "$HOST"

# .env + scripts (crons hôte)
ln -sf "$VOL/.env" "$HOST/.env"
mkdir -p "$HOST/scripts"
for s in "$VOL/scripts/"*.sh; do
  [ -f "$s" ] || continue
  base=$(basename "$s")
  if [ ! -f "$HOST/scripts/$base" ] || [ "$HOST/scripts/$base" -ot "$s" ]; then
    cp "$s" "$HOST/scripts/$base"
    chmod +x "$HOST/scripts/$base"
  fi
done

# Espaces fichiers (symlinks vers volume)
for name in livrables sources travail rep_tech_hermes; do
  target="$VOL/$name"
  mkdir -p "$target"
  if [ ! -L "$HOST/$name" ] || [ "$(readlink -f "$HOST/$name" 2>/dev/null)" != "$target" ]; then
    rm -rf "$HOST/$name" 2>/dev/null || true
    ln -sf "$target" "$HOST/$name"
  fi
done

echo "=== Host sync OK ==="
ls -la "$HOST/.env" "$HOST/scripts" "$HOST/livrables" "$HOST/rep_tech_hermes" 2>/dev/null | head -8
