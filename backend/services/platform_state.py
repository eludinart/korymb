"""État plateforme versionné (docs/PLATFORM_STATE.md) — ancrage chat / mémoire."""
from __future__ import annotations

from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_PLATFORM_STATE_PATH = _REPO_ROOT / "docs" / "PLATFORM_STATE.md"


def platform_state_path() -> Path:
    return _PLATFORM_STATE_PATH


def load_platform_state_text(*, max_chars: int = 3500) -> str:
    """Contenu du fichier d'état ; vide si absent."""
    path = platform_state_path()
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""
    if not text:
        return ""
    lim = max(400, int(max_chars))
    if len(text) <= lim:
        return text
    return text[: lim - 1].rstrip() + "…"


def format_platform_state_prompt(*, max_chars: int = 3500) -> str:
    body = load_platform_state_text(max_chars=max_chars)
    if not body:
        return ""
    return "### État plateforme (docs/PLATFORM_STATE.md — ne pas contredire)\n" + body


def clear_platform_state_cache() -> None:
    """Compat tests — lecture fichier légère, pas de cache."""
    return


def developpeur_memory_payload_from_platform_state() -> str:
    """Texte à fusionner dans le volet mémoire `developpeur`."""
    body = load_platform_state_text(max_chars=8000)
    if not body:
        return ""
    return (
        "État plateforme Korymb (sync depuis docs/PLATFORM_STATE.md).\n"
        "Source de vérité courte pour le CIO — mettre à jour après chaque chantier déployé.\n\n"
        + body
    )
