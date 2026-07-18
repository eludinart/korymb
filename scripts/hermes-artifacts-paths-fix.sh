#!/usr/bin/env bash
# Rend les anciens chemins d'artefacts WebUI accessibles (sessions historiques).
set -euo pipefail
DATA="/docker/hermes-agent-aoxw/data"
HYP="$DATA/livrables/2026-07-12-hypnose"
LIV="$DATA/livrables"

[ -d "$HYP" ] || { echo "SKIP hypnose (dossier absent: $HYP)"; exit 0; }

# Anciens chemins write_file / artefacts chat (symlinks RELATIFS pour le conteneur WebUI)
rm -rf "$DATA/hypnose_scripts" "$DATA/audio_hypnose" 2>/dev/null || true
ln -sf "livrables/2026-07-12-hypnose" "$DATA/hypnose_scripts"
mkdir -p "$DATA/audio_hypnose"
for f in "$HYP"/*.mp3; do
  [ -f "$f" ] || continue
  ln -sf "../livrables/2026-07-12-hypnose/$(basename "$f")" "$DATA/audio_hypnose/$(basename "$f")"
done

# /workspace/script_*.md (workspace = livrables)
for f in "$HYP"/*; do
  base=$(basename "$f")
  target="$LIV/$base"
  if [ ! -e "$target" ]; then
    ln -sf "2026-07-12-hypnose/$base" "$target"
  fi
done

# Hôte SSH (si Hermes écrit encore via /opt/data sur l'hôte)
HOST=/opt/data
if [ -d "$HOST" ] && [ "$HOST" != "$DATA" ]; then
  rm -rf "$HOST/hypnose_scripts" 2>/dev/null || true
  ln -sf "livrables/2026-07-12-hypnose" "$HOST/hypnose_scripts" 2>/dev/null || true
fi

echo "=== Vérification chemins artefacts (hôte) ==="
for p in \
  "$DATA/hypnose_scripts/script_hypnose_arret_tabac_urgent.pdf" \
  "$DATA/hypnose_scripts/script_hypnose_arret_tabac_urgent.txt" \
  "$DATA/hypnose_scripts/script_hypnose_arret_tabac_urgent.md" \
  "$LIV/script_hypnose_arret_tabac_urgent.md"; do
  if [ -f "$p" ] || [ -L "$p" ]; then
    echo "OK $p"
  else
    echo "MISSING $p"
    exit 1
  fi
done

WEBUI=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'hermes-webui' | head -1 || true)
if [ -n "$WEBUI" ]; then
  echo "=== Vérification conteneur WebUI ($WEBUI) ==="
  for p in \
    /opt/data/hypnose_scripts/script_hypnose_arret_tabac_urgent.pdf \
    /opt/data/hypnose_scripts/script_hypnose_arret_tabac_urgent.txt \
    /workspace/script_hypnose_arret_tabac_urgent.md; do
    if docker exec "$WEBUI" test -f "$p" 2>/dev/null; then
      echo "OK $p"
    else
      echo "MISSING in container: $p"
      exit 1
    fi
  done
fi
