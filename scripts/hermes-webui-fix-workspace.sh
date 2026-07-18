#!/usr/bin/env bash
# Aligne sessions WebUI sur l'espace Livrables (workspace par défaut).
set -euo pipefail
STATE="/opt/data/hermes-webui-state"
TARGET="/opt/data/livrables"
echo "$TARGET" > "$STATE/last_workspace.txt"
python3 <<PY
import json, glob, os
state = "/opt/data/hermes-webui-state/sessions"
target = "$TARGET"
for path in glob.glob(state + "/*.json"):
    if os.path.basename(path).startswith("_"):
        continue
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    old = d.get("workspace") or d.get("cwd")
    if old != target:
        d["workspace"] = target
        if "cwd" in d:
            d["cwd"] = target
        with open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=2)
            f.write("\n")
        print(f"updated {os.path.basename(path)}: {old!r} -> {target}")
    else:
        print(f"ok {os.path.basename(path)}")
PY
echo "last_workspace=$TARGET"
