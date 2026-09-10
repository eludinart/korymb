#!/usr/bin/env python3
"""Build wordpress/dist/eludein-child.zip for upload via WP Admin → Apparence → Thèmes."""
from __future__ import annotations

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
THEME = ROOT / "wordpress" / "themes" / "eludein-child"
OUT_DIR = ROOT / "wordpress" / "dist"
OUT = OUT_DIR / "eludein-child.zip"
SKIP = {".DS_Store"}


def main() -> None:
    if not THEME.is_dir():
        raise SystemExit(f"Thème introuvable : {THEME}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    count = 0
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in THEME.rglob("*"):
            if not path.is_file() or path.name in SKIP:
                continue
            arc = Path("eludein-child") / path.relative_to(THEME)
            zf.write(path, arcname=arc.as_posix())
            count += 1
    try:
        shown = OUT.relative_to(ROOT)
    except ValueError:
        shown = OUT
    print(f"OK {count} fichier(s) → {shown}")
    print("À envoyer dans WordPress : Apparence → Thèmes → Ajouter → Téléverser.")
    print("Ensuite activer « Élude In Art Child ». OceanWP reste le parent.")


if __name__ == "__main__":
    main()
