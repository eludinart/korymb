#!/usr/bin/env bash
# Clarifie Hermes WebUI : workspace = livrables uniquement, sync hôte→volume, permissions.
set -euo pipefail

HOST_DATA="/opt/data"
VOL_DATA="/docker/hermes-agent-aoxw/data"
LIV="$VOL_DATA/livrables"
SRC="$VOL_DATA/sources"
HYP="$LIV/2026-07-12-hypnose"

mkdir -p "$LIV" "$SRC" "$HYP"

# Lien hôte : futurs fichiers SSH via /opt/data/livrables → volume réel
mkdir -p "$HOST_DATA/livrables" 2>/dev/null || true
if [ ! -L "$HOST_DATA/livrables" ] || [ "$(readlink -f "$HOST_DATA/livrables")" != "$LIV" ]; then
  rm -rf "$HOST_DATA/livrables"
  ln -sf "$LIV" "$HOST_DATA/livrables"
  echo "symlink hôte /opt/data/livrables -> volume"
fi

# Sync livrables créés par Hermes SSH sur l'hôte (hors volume)
for src_dir in hypnose_scripts audio_hypnose; do
  if [ -d "$HOST_DATA/$src_dir" ]; then
    cp -an "$HOST_DATA/$src_dir/"* "$HYP/" 2>/dev/null || true
    echo "synced host $src_dir -> livrables/hypnose"
  fi
done

# README
cat > "$LIV/README.md" <<'EOF'
# Livrables Éric

**Seul dossier à consulter** dans Hermes WebUI.

| Sous-dossier | Contenu |
|--------------|---------|
| `2026-07-12-hypnose/` | Script, PDF, TXT, audio |

Hermes : déposer **uniquement** ici (`/opt/data/livrables/`).
EOF

chown -R 10000:10000 "$LIV" "$SRC"
find "$LIV" -type f -exec chmod 644 {} \;
find "$LIV" -type d -exec chmod 755 {} \;

# WebUI : sessions + settings
python3 <<'PY'
import json, glob, os
state = "/docker/hermes-agent-aoxw/data/hermes-webui-state"
target = "/opt/data/livrables"
settings = os.path.join(state, "settings.json")
if os.path.isfile(settings):
    with open(settings, encoding="utf-8") as f:
        s = json.load(f)
    s["default_workspace"] = target
    s["workspace_panel_open_on_new_session"] = True
    with open(settings, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=4)
        f.write("\n")
for path in glob.glob(state + "/sessions/*.json"):
    if os.path.basename(path).startswith("_"):
        continue
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    d["workspace"] = target
    if "cwd" in d:
        d["cwd"] = target
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
open(os.path.join(state, "last_workspace.txt"), "w").write(target + "\n")
print("webui workspace ->", target)
PY

chown -R 10000:10000 "$VOL_DATA/hermes-webui-state" 2>/dev/null || true

echo "=== Livrables ==="
find "$LIV" -type f | sort
echo "=== count ==="
find "$LIV" -type f | wc -l
