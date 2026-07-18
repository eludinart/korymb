#!/usr/bin/env bash
# Optimisation complète environnement Hermes (agent + WebUI + hôte VPS).
set -euo pipefail

HERMES_DIR="/docker/hermes-agent-aoxw"
DATA="$HERMES_DIR/data"
STATE="$DATA/hermes-webui-state"
AGENT="hermes-agent-aoxw-hermes-agent-1"
WEBUI=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'hermes-webui' | head -1 || true)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run() {
  if [ -f "$SCRIPT_DIR/$1" ]; then
    bash "$SCRIPT_DIR/$1"
  elif [ -f "/tmp/$1" ]; then
    bash "/tmp/$1"
  else
    echo "SKIP $1 (introuvable)"
  fi
}

echo "=== 1. Permissions critiques ==="
chown 10000:10000 "$DATA/.env" 2>/dev/null || true
chmod 600 "$DATA/.env"
chown -R 10000:10000 "$DATA/hermes-webui-state" "$DATA/livrables" "$DATA/sources" "$DATA/travail" "$DATA/rep_tech_hermes" 2>/dev/null || true

echo "=== 2. Sync hôte /opt/data ==="
run hermes-host-sync.sh

echo "=== 3. Layout espaces WebUI ==="
run hermes-workspace-layout.sh

echo "=== 4. Config modèle Mistral ==="
python3 <<'PY'
from pathlib import Path
import re

path = Path("/docker/hermes-agent-aoxw/data/config.yaml")
text = path.read_text(encoding="utf-8")
orig = text

# provider custom + base_url Mistral (évite custom:mistral + base_url vide)
text = re.sub(
    r"(\nmodel:\n\s+provider:\s*)custom:mistral(\s*\n\s+base_url:\s*)''",
    r"\1custom\2'https://api.mistral.ai/v1'",
    text,
    count=1,
)
if "base_url: ''" in text and "model:" in text:
    text = re.sub(
        r"(model:\n\s+provider:\s*custom\n\s+base_url:\s*)''",
        r"\1'https://api.mistral.ai/v1'",
        text,
        count=1,
    )

if text != orig:
    path.write_text(text, encoding="utf-8")
    print("config.yaml: modèle Mistral corrigé (provider custom + base_url)")
else:
    print("config.yaml: modèle déjà OK")
PY

echo "=== 5. Sessions WebUI → livrables ==="
python3 <<'PY'
import json, glob, os

state = "/docker/hermes-agent-aoxw/data/hermes-webui-state/sessions"
target = "/opt/data/livrables"
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
        print(f"session {os.path.basename(path)}: {old!r} -> {target}")
print("last_workspace -> livrables")
open("/docker/hermes-agent-aoxw/data/hermes-webui-state/last_workspace.txt", "w").write(target + "\n")
PY

echo "=== 6. Smoke checks ==="
FAIL=0

check() {
  if eval "$2" >/dev/null 2>&1; then
    echo "OK  $1"
  else
    echo "FAIL $1"
    FAIL=$((FAIL + 1))
  fi
}

check "agent .env lisible" "docker exec $AGENT bash -lc 'gosu hermes test -r /opt/data/.env'"
check "SSH terminal" "docker exec $AGENT bash -lc 'gosu hermes ssh -o BatchMode=yes -o StrictHostKeyChecking=no -i /opt/data/.ssh/id_ed25519 root@10.0.3.1 hostname'"
check "docker exec" "docker exec $AGENT bash -lc 'gosu hermes docker ps -q' | grep -q ."
check "korymb-sql" "docker exec $AGENT /opt/data/scripts/korymb-sql.sh 'SELECT 1'"
check "fleur-sql" "docker exec $AGENT /opt/data/scripts/fleur-sql.sh 'SELECT 1'"
check "hermes HTTPS" "curl -sf -o /dev/null -w '%{http_code}' https://hermes.eludein.art/ | grep -qE '302|200'"
check "webui HTTPS" "curl -sf -o /dev/null -w '%{http_code}' https://hermeswebui.eludein.art/ | grep -qE '302|200'"

if [ -n "$WEBUI" ]; then
  check "webui healthy" "docker inspect -f '{{.State.Health.Status}}' $WEBUI | grep -q healthy"
  check "hermes-agent-src" "docker exec $WEBUI test -d /opt/hermes/agent"
  check "workspace livrables" "docker exec $WEBUI test -d /opt/data/livrables"
  check "/workspace symlink" "docker exec $WEBUI test -L /workspace"
fi

if grep -q KORYMB_AGENT_SECRET "$DATA/.env" 2>/dev/null; then
  check "korymb-api" "/opt/data/scripts/korymb-api.sh health"
else
  echo "WARN korymb-api: KORYMB_AGENT_SECRET absent dans data/.env (pont API Korymb inactif)"
fi

if [ "$FAIL" -gt 0 ]; then
  echo "=== $FAIL échec(s) smoke ==="
  exit 1
fi

echo "=== Hermes optimisé — tous les checks passent ==="
