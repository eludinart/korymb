"""Kill uvicorn on 8020 and start a fresh backend (dev)."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]
PORT = 8020


def _kill_port(port: int) -> None:
    ps = (
        f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
        "ForEach-Object { taskkill /F /PID $_.OwningProcess /T 2>$null }"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=False)


def _load_secret() -> str:
    for line in (BACKEND / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("AGENT_API_SECRET="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("AGENT_API_SECRET missing")


def main() -> int:
    _kill_port(PORT)
    time.sleep(3)
    log_out = BACKEND.parent / ".dev-logs" / "backend-agent-restart.log"
    log_err = BACKEND.parent / ".dev-logs" / "backend-agent-restart.err.log"
    log_out.parent.mkdir(parents=True, exist_ok=True)
    with open(log_out, "a", encoding="utf-8") as fo, open(log_err, "a", encoding="utf-8") as fe:
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "main:app",
                "--app-dir",
                str(BACKEND),
                "--host",
                "127.0.0.1",
                "--port",
                str(PORT),
            ],
            cwd=str(BACKEND),
            stdout=fo,
            stderr=fe,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
    secret = _load_secret()
    headers = {"X-Agent-Secret": secret}
    for _ in range(45):
        time.sleep(2)
        try:
            health = httpx.get(f"http://127.0.0.1:{PORT}/health", timeout=3).json()
            print("health", health.get("version"))
            agents = httpx.get(f"http://127.0.0.1:{PORT}/agents", headers=headers, timeout=10).json()
            for row in agents.get("agents") or []:
                if row.get("key") == "commercial":
                    print("commercial tools", row.get("tools"))
            return 0
        except Exception:
            continue
    print("backend not ready", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
