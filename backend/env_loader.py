"""Charge backend/.env puis backend/.env.local (surcharges dev, ex. tunnel MariaDB VPS)."""
from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parent


def load_backend_env() -> None:
    """`.env` = secrets + défauts ; `.env.local` = surcharge dev (tunnel MariaDB, etc.)."""
    env_file = _BACKEND_DIR / ".env"
    local_file = _BACKEND_DIR / ".env.local"
    if env_file.is_file():
        load_dotenv(env_file, override=False)
    if local_file.is_file():
        load_dotenv(local_file, override=True)
