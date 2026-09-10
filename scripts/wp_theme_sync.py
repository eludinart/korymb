#!/usr/bin/env python3
"""Sync the OceanWP child theme only (never WordPress core or plugins)."""
from __future__ import annotations

import argparse
import json
import sys
from ftplib import FTP, FTP_TLS, error_perm
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


def connect(cfg: dict):
    host = cfg["host"]
    port = int(cfg.get("port") or 21)
    user = cfg["user"]
    password = cfg["password"]
    secure = bool(cfg.get("secure", True))
    if not password or str(password).startswith("REMPLIR"):
        raise SystemExit(
            "Mot de passe FTP vide dans .ftpconfig — à coller depuis hPanel Hostinger (FTP Accounts)."
        )
    if secure:
        ftp: FTP = FTP_TLS()
        ftp.connect(host, port, timeout=30)
        ftp.auth()
        ftp.prot_p()
    else:
        ftp = FTP()
        ftp.connect(host, port, timeout=30)
    ftp.login(user, password)
    ftp.set_pasv(True)
    return ftp


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


def ensure_remote_dir(ftp: FTP, path: str) -> None:
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    acc = ""
    leading = path.startswith("/")
    for part in parts:
        acc = f"{acc}/{part}" if acc else (f"/{part}" if leading else part)
        try:
            ftp.mkd(acc)
        except error_perm:
            pass
    ftp.cwd(path)


def cmd_status(cfg: dict) -> int:
    print(f"config     : {cfg.get('_config_path')}")
    print(f"host       : {cfg.get('host')}:{cfg.get('port')}")
    print(f"user       : {cfg.get('user')}")
    print(f"secure     : {cfg.get('secure')}")
    print(f"remotePath : {cfg.get('remotePath')}")
    print(f"local      : {THEME_REL}")
    print(f"fichiers   : {len(local_files())}")
    try:
        ftp = connect(cfg)
    except SystemExit as exc:
        print(f"connexion  : non ({exc})")
        return 1
    except Exception as exc:
        print(f"connexion  : échec ({exc})")
        return 1
    assert_safe_remote(cfg["remotePath"])
    try:
        ftp.cwd(cfg["remotePath"])
        names = ftp.nlst()
        print(f"distant    : OK ({len(names)} entrée(s))")
        return 0
    except error_perm as exc:
        print(f"distant    : dossier absent ({exc}) — un push le créera")
        return 0
    finally:
        ftp.close()


def cmd_push(cfg: dict) -> int:
    assert_safe_remote(cfg["remotePath"])
    files = local_files()
    ftp = connect(cfg)
    try:
        ensure_remote_dir(ftp, cfg["remotePath"])
        for path in files:
            rel = path.relative_to(ROOT / THEME_REL).as_posix()
            parent = Path(rel).parent.as_posix()
            if parent not in (".", ""):
                ensure_remote_dir(ftp, f"{cfg['remotePath'].rstrip('/')}/{parent}")
            dest = f"{cfg['remotePath'].rstrip('/')}/{rel}"
            with path.open("rb") as handle:
                ftp.storbinary(f"STOR {dest}", handle)
            print(f"push {rel}")
        print(f"OK {len(files)} fichier(s) → {cfg['remotePath']}")
        return 0
    finally:
        ftp.close()


def _is_dir(ftp: FTP, remote: str) -> bool:
    current = ftp.pwd()
    try:
        ftp.cwd(remote)
        ftp.cwd(current)
        return True
    except error_perm:
        return False


def cmd_pull(cfg: dict) -> int:
    assert_safe_remote(cfg["remotePath"])
    local_root = ROOT / THEME_REL
    ftp = connect(cfg)
    downloaded = 0
    try:
        def walk(remote_dir: str, rel: str) -> None:
            nonlocal downloaded
            names = ftp.nlst(remote_dir)
            for raw in names:
                name = raw.split("/")[-1]
                if name in (".", ".."):
                    continue
                remote = f"{remote_dir.rstrip('/')}/{name}"
                if _is_dir(ftp, remote):
                    walk(remote, f"{rel}/{name}" if rel else name)
                    continue
                suffix = Path(name).suffix.lower()
                if suffix not in ALLOWED_SUFFIXES:
                    continue
                local = local_root / rel / name if rel else local_root / name
                local.parent.mkdir(parents=True, exist_ok=True)
                with local.open("wb") as handle:
                    ftp.retrbinary(f"RETR {remote}", handle.write)
                downloaded += 1
                print(f"pull {rel + '/' if rel else ''}{name}")

        ftp.cwd(cfg["remotePath"])
        walk(cfg["remotePath"], "")
        print(f"OK {downloaded} fichier(s) ← {cfg['remotePath']}")
        return 0
    finally:
        ftp.close()


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
