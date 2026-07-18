#!/usr/bin/env bash
# Layout Espaces Hermes WebUI : livrables, sources, travail, rep_tech_hermes.
set -euo pipefail

VOL_DATA="/docker/hermes-agent-aoxw/data"
HOST_DATA="/opt/data"
LIV="$VOL_DATA/livrables"
SRC="$VOL_DATA/sources"
TRAVAIL="$VOL_DATA/travail"
TECH="$VOL_DATA/rep_tech_hermes"
STATE="$VOL_DATA/hermes-webui-state"

mkdir -p "$LIV" "$SRC" "$TRAVAIL" "$TECH"

# Sync hôte /opt/data (SSH + crons)
if [ -f "$(dirname "$0")/hermes-host-sync.sh" ]; then
  bash "$(dirname "$0")/hermes-host-sync.sh"
elif [ -f /tmp/hermes-host-sync.sh ]; then
  bash /tmp/hermes-host-sync.sh
fi

# Liens hôte → volume (Hermes SSH)
for name in livrables sources travail rep_tech_hermes; do
  target="$VOL_DATA/$name"
  if [ ! -L "$HOST_DATA/$name" ] || [ "$(readlink -f "$HOST_DATA/$name" 2>/dev/null)" != "$target" ]; then
    rm -rf "$HOST_DATA/$name" 2>/dev/null || true
    ln -sf "$target" "$HOST_DATA/$name"
  fi
done

# README livrables
cat > "$LIV/README.md" <<'EOF'
# Livrables

Fichiers produits par Hermes pour Éric (scripts, audio, PDF, exports).

Hermes : déposer **uniquement** ici — pas à la racine `/opt/data/`.
EOF

cat > "$SRC/README.md" <<'EOF'
# Sources

Documents d'entrée, briefs, assets de référence pour tes projets.
EOF

cat > "$TRAVAIL/README.md" <<'EOF'
# Travail

Workspace classique — brouillons, notes, projets en cours (hors livrables finaux).
EOF

# rep_tech_hermes : vue technique organisée (symlinks lecture)
cat > "$TECH/README.md" <<'EOF'
# rep_tech_hermes — Infos système Hermes

Vue **organisée** du technique. Les dossiers ci-dessous sont des raccourcis vers `/opt/data/`.

| Lien | Contenu |
|------|---------|
| `scripts/` | Scripts ops (SQL, briefing, API…) |
| `logs/` | Logs agent / gateway |
| `memories/` | Mémoire Hermes (dont decisions-eric) |
| `skills/` | Skills actives |
| `cron/` | Tâches planifiées |
| `gateway/` | État gateway |
| `config.yaml` | Config agent (lecture — ne pas modifier sans Eric) |
| `SOUL.md` | Personnalité agent |

**Ne pas modifier** sans accord : `.env`, compose Docker, labels Traefik.
EOF

link_tech() {
  local name="$1"
  local target="$2"
  rm -f "$TECH/$name" 2>/dev/null || true
  if [ -e "$VOL_DATA/$target" ]; then
    ln -sf "../$target" "$TECH/$name"
  fi
}

link_tech scripts scripts
link_tech logs logs
link_tech memories memories
link_tech skills skills
link_tech cron cron
link_tech gateway gateway
link_tech config.yaml config.yaml
link_tech SOUL.md SOUL.md

# Espaces WebUI
python3 <<'PY'
import json, os
state = "/docker/hermes-agent-aoxw/data/hermes-webui-state"
workspaces = [
    {"path": "/opt/data/livrables", "name": "Livrables"},
    {"path": "/opt/data/sources", "name": "Sources"},
    {"path": "/opt/data/travail", "name": "Travail"},
    {"path": "/opt/data/rep_tech_hermes", "name": "rep_tech_hermes"},
]
# Écrase workspaces.json (supprime espaces obsolètes type audio_hypnose)
with open(os.path.join(state, "workspaces.json"), "w", encoding="utf-8") as f:
    json.dump(workspaces, f, indent=2)
    f.write("\n")
settings = os.path.join(state, "settings.json")
if os.path.isfile(settings):
    with open(settings, encoding="utf-8") as f:
        s = json.load(f)
    s["default_workspace"] = "/opt/data/livrables"
    with open(settings, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=4)
        f.write("\n")
open(os.path.join(state, "last_workspace.txt"), "w").write("/opt/data/livrables\n")
print("workspaces.json updated")
PY

chown -R 10000:10000 "$LIV" "$SRC" "$TRAVAIL" "$TECH" "$STATE/workspaces.json"
find "$LIV" "$SRC" "$TRAVAIL" "$TECH" -type f -exec chmod 644 {} \;
find "$LIV" "$SRC" "$TRAVAIL" "$TECH" -type d -exec chmod 755 {} \;

echo "=== Espaces ==="
cat "$STATE/workspaces.json"
echo "=== rep_tech_hermes ==="
ls -la "$TECH"

# Chemins legacy pour onglet Artefacts (sessions historiques)
if [ -f "$(dirname "$0")/hermes-artifacts-paths-fix.sh" ]; then
  bash "$(dirname "$0")/hermes-artifacts-paths-fix.sh"
elif [ -f /tmp/hermes-artifacts-paths-fix.sh ]; then
  bash /tmp/hermes-artifacts-paths-fix.sh
fi
