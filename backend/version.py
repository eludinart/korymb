"""
Version du backend Korymb — incrémenter BACKEND_VERSION à chaque livraison.
La date/heure de révision est dérivée de la dernière modification de ce fichier (mtime),
pour refléter le dernier « stamp » sans pipeline CI.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

BACKEND_VERSION = "3.0.7"

_dir = Path(__file__).resolve().parent
try:
    _stamp = os.path.getmtime(_dir / "version.py")
    BACKEND_REVISION_AT = datetime.fromtimestamp(_stamp, tz=timezone.utc).isoformat()
except OSError:
    BACKEND_REVISION_AT = ""
