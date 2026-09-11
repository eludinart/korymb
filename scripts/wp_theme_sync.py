#!/usr/bin/env python3
"""Sync the OceanWP child theme only (never WordPress core or plugins).

Hostinger: SFTP port 65002 is the reliable path from Cursor Cloud.
FTP :21 authenticates but the passive data channel is often blocked.
"""
from __future__ import annotations

import argparse
import json
import stat
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_CANDIDATES = [
    ROOT / ".ftpconfig",
    ROOT / "wordpress" / ".ftpconfig",
]
THEME_REL = Path("wordpress/themes/eludein-child")
ALLOWED_SUFFIXES = {".css", ".php", ".js", ".json", ".md", ".png", ".svg", ".woff2", ".txt"}


def load_config() -> dict:
    for path in CONFIG_CANDIDATES:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            data["_config_path"] = str(path)
            return data
    example = ROOT / ".ftpconfig.example"
    raise SystemExit(
        "Aucun .ftpconfig trouvé.\n"
        f"Copier {example.name} vers .ftpconfig (gitignoré) et renseigner le mot de passe hPanel.\n"
        "Fichiers cherchés : " + ", ".join(str(p.relative_to(ROOT)) for p in CONFIG_CANDIDATES)
    )


def require_password(cfg: dict) -> str:
    password = cfg.get("password") or ""
    if not password or str(password).startswith("REMPLIR"):
        raise SystemExit(
            "Mot de passe vide dans .ftpconfig — à coller depuis hPanel Hostinger (FTP Accounts)."
        )
    return str(password)


def protocol_from_cfg(cfg: dict) -> str:
    explicit = str(cfg.get("protocol") or "").strip().lower()
    if explicit in {"sftp", "ftp", "ftps"}:
        return explicit
    port = int(cfg.get("port") or 21)
    if port == 65002:
        return "sftp"
    if cfg.get("secure", True):
        return "ftps"
    return "ftp"


def assert_safe_remote(remote_path: str) -> None:
    normalized = remote_path.replace("\\", "/").lower().rstrip("/")
    if not normalized.endswith("eludein-child"):
        raise SystemExit(
            f"Chemin distant refusé ({remote_path}). "
            "Le sync ne peut cibler que le dossier du thème enfant …/eludein-child"
        )


def local_files() -> list[Path]:
    theme = ROOT / THEME_REL
    if not theme.is_dir():
        raise SystemExit(f"Thème local introuvable : {theme}")
    files = []
    for path in theme.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            continue
        rel = path.relative_to(theme).as_posix()
        if any(bad in rel.replace("\\", "/") for bad in ("wp-admin", "wp-includes")):
            continue
        files.append(path)
    return files


class SftpSession:
    def __init__(self, cfg: dict):
        try:
            import paramiko
        except ImportError as exc:
            raise SystemExit("Installer paramiko : pip3 install paramiko") from exc
        password = require_password(cfg)
        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self._client.connect(
            hostname=cfg["host"],
            port=int(cfg.get("port") or 65002),
            username=cfg["user"],
            password=password,
            timeout=25,
            allow_agent=False,
            look_for_keys=False,
        )
        self.sftp = self._client.open_sftp()

    def close(self) -> None:
        self.sftp.close()
        self._client.close()

    def exists(self, path: str) -> bool:
        try:
            self.sftp.stat(path)
            return True
        except (FileNotFoundError, OSError):
            return False

    def listdir(self, path: str) -> list[str]:
        return self.sftp.listdir(path)

    def mkdir_p(self, path: str) -> None:
        parts = [p for p in path.replace("\\", "/").split("/") if p]
        acc = ""
        for part in parts:
            acc = f"{acc}/{part}"
            try:
                self.sftp.stat(acc)
            except (FileNotFoundError, OSError):
                try:
                    self.sftp.mkdir(acc)
                except OSError:
                    pass

    def put(self, local: Path, remote: str) -> None:
        self.sftp.put(str(local), remote)

    def get(self, remote: str, local: Path) -> None:
        local.parent.mkdir(parents=True, exist_ok=True)
        self.sftp.get(remote, str(local))

    def isdir(self, path: str) -> bool:
        try:
            return stat.S_ISDIR(self.sftp.stat(path).st_mode)
        except (FileNotFoundError, OSError):
            return False


def cmd_status(cfg: dict) -> int:
    proto = protocol_from_cfg(cfg)
    print(f"config     : {cfg.get('_config_path')}")
    print(f"protocol   : {proto}")
    print(f"host       : {cfg.get('host')}:{cfg.get('port')}")
    print(f"user       : {cfg.get('user')}")
    print(f"remotePath : {cfg.get('remotePath')}")
    print(f"local      : {THEME_REL}")
    print(f"fichiers   : {len(local_files())}")
    assert_safe_remote(cfg["remotePath"])
    if proto != "sftp":
        print("connexion  : utiliser protocol=sftp / port=65002 (FTP passif bloqué depuis Cursor Cloud)")
        return 1
    try:
        session = SftpSession(cfg)
    except SystemExit as exc:
        print(f"connexion  : non ({exc})")
        return 1
    except Exception as exc:
        print(f"connexion  : échec ({exc})")
        return 1
    try:
        if session.exists(cfg["remotePath"]):
            names = session.listdir(cfg["remotePath"])
            print(f"connexion  : OK")
            print(f"distant    : OK ({len(names)} entrée(s))")
        else:
            print("connexion  : OK")
            print("distant    : dossier absent — un push le créera")
        return 0
    finally:
        session.close()


def cmd_push(cfg: dict) -> int:
    assert_safe_remote(cfg["remotePath"])
    if protocol_from_cfg(cfg) != "sftp":
        raise SystemExit("push : protocol sftp requis (port 65002).")
    files = local_files()
    session = SftpSession(cfg)
    try:
        session.mkdir_p(cfg["remotePath"])
        for path in files:
            rel = path.relative_to(ROOT / THEME_REL).as_posix()
            dest = f"{cfg['remotePath'].rstrip('/')}/{rel}"
            parent = str(Path(dest).parent).replace("\\", "/")
            session.mkdir_p(parent)
            session.put(path, dest)
            print(f"push {rel}")
        print(f"OK {len(files)} fichier(s) → {cfg['remotePath']}")
        return 0
    finally:
        session.close()


def cmd_pull(cfg: dict) -> int:
    assert_safe_remote(cfg["remotePath"])
    if protocol_from_cfg(cfg) != "sftp":
        raise SystemExit("pull : protocol sftp requis (port 65002).")
    local_root = ROOT / THEME_REL
    session = SftpSession(cfg)
    downloaded = 0
    try:
        if not session.exists(cfg["remotePath"]):
            print(f"distant absent : {cfg['remotePath']}")
            return 1

        def walk(remote_dir: str, rel: str) -> None:
            nonlocal downloaded
            for name in session.listdir(remote_dir):
                if name in (".", ".."):
                    continue
                remote = f"{remote_dir.rstrip('/')}/{name}"
                if session.isdir(remote):
                    walk(remote, f"{rel}/{name}" if rel else name)
                    continue
                suffix = Path(name).suffix.lower()
                if suffix not in ALLOWED_SUFFIXES:
                    continue
                local = local_root / rel / name if rel else local_root / name
                session.get(remote, local)
                downloaded += 1
                print(f"pull {rel + '/' if rel else ''}{name}")

        walk(cfg["remotePath"], "")
        print(f"OK {downloaded} fichier(s) ← {cfg['remotePath']}")
        return 0
    finally:
        session.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("status", "push", "pull"))
    args = parser.parse_args()
    cfg = load_config()
    if args.command == "status":
        return cmd_status(cfg)
    if args.command == "push":
        return cmd_push(cfg)
    return cmd_pull(cfg)


if __name__ == "__main__":
    sys.exit(main())
