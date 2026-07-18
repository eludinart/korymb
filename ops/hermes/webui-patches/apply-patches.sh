#!/usr/bin/env bash
# Patches Hermes WebUI pour ouvrir les artefacts sous /opt/data (hors workspace session).
set -euo pipefail

# Runtime Python imports from /apptoo; static assets may be served from /app or /apptoo.
for APP_ROOT in /apptoo /app; do
  [ -d "$APP_ROOT/api" ] || continue
  export APP_ROOT
  export ROUTES="$APP_ROOT/api/routes.py"
  export WS="$APP_ROOT/static/workspace.js"
  python3 <<'PY'
from pathlib import Path
import os

MARKER = "HERMES_HOME_ABSPATH_READ"
routes = Path(os.environ["ROUTES"])
ws = Path(os.environ["WS"])

if routes.is_file() and MARKER not in routes.read_text(encoding="utf-8"):
    text = routes.read_text(encoding="utf-8")
    helper = '''
# HERMES_HOME_ABSPATH_READ — artifact/file open for absolute paths under HERMES_HOME
def _hermes_home_root():
    import os
    from pathlib import Path
    return Path(os.environ.get("HERMES_HOME", "/opt/data")).resolve()

def _read_hermes_home_abs_file(abs_path: str) -> dict:
    import os
    import stat
    from pathlib import Path
    from api.workspace import MAX_FILE_BYTES

    root = _hermes_home_root()
    target = Path(abs_path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"Path outside HERMES_HOME: {abs_path}") from exc
    if not target.is_file():
        raise FileNotFoundError(f"Not a file: {abs_path}")
    fd = os.open(str(target), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise FileNotFoundError(f"Not a file: {abs_path}")
        if st.st_size > MAX_FILE_BYTES:
            raise ValueError(f"File too large ({st.st_size} bytes, max {MAX_FILE_BYTES})")
        raw = os.read(fd, MAX_FILE_BYTES + 1)
    finally:
        os.close(fd)
    content = raw.decode("utf-8", errors="replace")
    rel = target.relative_to(root).as_posix()
    return {"path": rel, "content": content, "size": len(raw), "lines": content.count("\\n") + 1}

def _resolve_workspace_file_read(workspace, rel: str) -> dict:
    rel_path = str(rel or "").strip()
    if rel_path.startswith("/"):
        return _read_hermes_home_abs_file(rel_path)
    return read_file_content(Path(workspace), rel_path)

'''
    anchor = "def _file_raw_target(session, sid: str, rel: str) -> tuple[Path, Path] | None:"
    if anchor not in text:
        raise SystemExit(f"anchor _file_raw_target not found in {routes}")
    text = text.replace(anchor, helper + anchor, 1)

    old_raw = """def _file_raw_target(session, sid: str, rel: str) -> tuple[Path, Path] | None:
    \"\"\"Resolve /api/file/raw paths from the workspace or this session's uploads.\"\"\"
    workspace_root = Path(session.workspace)"""
    new_raw = """def _file_raw_target(session, sid: str, rel: str) -> tuple[Path, Path] | None:
    \"\"\"Resolve /api/file/raw paths from the workspace or this session's uploads.\"\"\"
    rel_path = str(rel or "").strip()
    if rel_path.startswith("/"):
        try:
            root = _hermes_home_root()
            target = Path(rel_path).resolve()
            target.relative_to(root)
            if target.is_file():
                return root, target
        except (ValueError, OSError):
            return None
    workspace_root = Path(session.workspace)"""
    if old_raw not in text:
        raise SystemExit(f"_file_raw_target body not found in {routes}")
    text = text.replace(old_raw, new_raw, 1)

    old_read = "        return j(handler, read_file_content(Path(s.workspace), rel))"
    new_read = "        return j(handler, _resolve_workspace_file_read(s.workspace, rel))"
    if old_read not in text:
        raise SystemExit(f"_handle_file_read body not found in {routes}")
    text = text.replace(old_read, new_read, 1)
    routes.write_text(text, encoding="utf-8")
    print(f"patched {routes}")

if ws.is_file() and "HERMES_ARTIFACT_ABSPATH" not in ws.read_text(encoding="utf-8"):
    text = ws.read_text(encoding="utf-8")
    old = """async function openArtifactPath(path){
  if(!path) return;
  switchWorkspacePanelTab('files');
  let rel = path.replace(/^~\\//,'').replace(/^\\.\\/+/,'');
  // Strip workspace prefix so /api/list receives a workspace-relative path.
  const ws = S.session && S.session.workspace;
  if(ws){
    const normWs = ws.replace(/\\/+$/,'') + '/';
    if(rel.startsWith(normWs)) rel = rel.slice(normWs.length);
    else if(rel === ws.replace(/\\/+$/,'')) rel = '.';
  }
  if(!rel) rel = '.';
  try{
    if(!(await _workspacePathExists(rel))){
      setStatus(t('file_open_failed'));
      return;
    }
  }catch(_){
    setStatus(t('file_open_failed'));
    return;
  }
  openFile(rel);
}"""
    new = """async function openArtifactPath(path){
  if(!path) return;
  switchWorkspacePanelTab('files');
  let rel = path.replace(/^~\\//,'').replace(/^\\.\\/+/,'');
  const DATA_ROOT = '/opt/data'; // HERMES_ARTIFACT_ABSPATH
  const ws = S.session && S.session.workspace;
  if((rel.startsWith(DATA_ROOT + '/') || rel === DATA_ROOT) && ws){
    const wsNorm = ws.replace(/\\/+$/,'');
    if(rel !== wsNorm && !rel.startsWith(wsNorm + '/')){
      openFile(rel);
      return;
    }
  }
  if(ws){
    const normWs = ws.replace(/\\/+$/,'') + '/';
    if(rel.startsWith(normWs)) rel = rel.slice(normWs.length);
    else if(rel === ws.replace(/\\/+$/,'')) rel = '.';
  }
  if(!rel) rel = '.';
  try{
    if(!(await _workspacePathExists(rel))){
      setStatus(t('file_open_failed'));
      return;
    }
  }catch(_){
    setStatus(t('file_open_failed'));
    return;
  }
  openFile(rel);
}"""
    if old not in text:
        raise SystemExit(f"openArtifactPath block not found in {ws}")
    ws.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {ws}")

route_old = """function _workspaceRouteForPathRel(path, kind, opts={}){
  if(!S.session) return '';
  const normalizedPath = _normalizeWorkspaceRelPath(path);
  const grant = _workspaceEscapeGrantForPath(normalizedPath);"""
route_new = """function _workspaceRouteForPathRel(path, kind, opts={}){
  if(!S.session) return '';
  let normalizedPath = _normalizeWorkspaceRelPath(path);
  const rawPath = String(path || '').trim();
  if((!normalizedPath || normalizedPath === '.') && rawPath.startsWith('/opt/data/')) normalizedPath = rawPath; // HERMES_ARTIFACT_ABSPATH
  const grant = _workspaceEscapeGrantForPath(normalizedPath);"""
if ws.is_file() and "HERMES_ARTIFACT_ABSPATH" in ws.read_text(encoding="utf-8") and route_old in ws.read_text(encoding="utf-8"):
    text = ws.read_text(encoding="utf-8").replace(route_old, route_new, 1)
    ws.write_text(text, encoding="utf-8")
    print(f"patched routes in {ws}")
PY
done

echo "WebUI patches applied"
