#!/usr/bin/env bash
set -euo pipefail
bash /opt/hermes-webui-patches/apply-patches.sh
source /app/venv/bin/activate
python3 <<'PY'
from api.routes import _resolve_workspace_file_read
r = _resolve_workspace_file_read('/opt/data/livrables', '/opt/data/scripts/eludein-morning-briefing.sh')
print('READ_OK', r['lines'])
PY
grep -q HERMES_ARTIFACT_ABSPATH /apptoo/static/workspace.js && echo JS_OK
grep -q HERMES_HOME_ABSPATH_READ /apptoo/api/routes.py && echo PY_OK
