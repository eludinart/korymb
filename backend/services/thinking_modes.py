"""Modes de pensée — styles cognitifs injectés en chat / mission."""
from __future__ import annotations

from typing import Any

THINKING_MODES = frozenset({"auto", "scientifique", "artiste", "philosophe", "enfant"})

_MODE_PROMPTS: dict[str, str] = {
    "scientifique": (
        "## Mode de pensée : Scientifique\n"
        "Privilégie logique, données, hypothèses testables et prudence. "
        "Structure : constat → hypothèse → preuves / contre-preuves → conclusion. "
        "Évite le lyrisme et les affirmations non sourcées."
    ),
    "artiste": (
        "## Mode de pensée : Artiste\n"
        "Privilégie associations libres, images, variations audacieuses et ton vivant. "
        "Propose plusieurs pistes avant de recentrer. "
        "Accepte l'ambiguïté créative ; ne force pas une seule « bonne » réponse."
    ),
    "philosophe": (
        "## Mode de pensée : Philosophe\n"
        "Questionne les présupposés, les valeurs et les cadres. "
        "Reformule le problème avant de résoudre. "
        "Relève les tensions éthiques ou conceptuelles sans moraliser."
    ),
    "enfant": (
        "## Mode de pensée : Enfant (curiosité)\n"
        "Pose des « pourquoi ? » naïfs et utiles. "
        "Simplifie sans infantiliser le dirigeant. "
        "Cherche l'étonnement et les angles oubliés."
    ),
}

_MODE_LABELS: dict[str, str] = {
    "auto": "Auto",
    "scientifique": "Scientifique",
    "artiste": "Artiste",
    "philosophe": "Philosophe",
    "enfant": "Curiosité",
}


def normalize_thinking_mode(raw: Any) -> str:
    mode = str(raw or "auto").strip().lower()
    return mode if mode in THINKING_MODES else "auto"


def thinking_mode_label(mode: str | None) -> str:
    m = normalize_thinking_mode(mode)
    return _MODE_LABELS.get(m, "Auto")


def thinking_mode_prompt_block(mode: str | None) -> str:
    m = normalize_thinking_mode(mode)
    if m == "auto":
        return ""
    return _MODE_PROMPTS.get(m, "")


def thinking_mode_from_job(job_id: str | None) -> str:
    if not job_id:
        return "auto"
    try:
        from state import active_jobs

        cfg = (active_jobs.get(job_id) or {}).get("mission_config") or {}
        if isinstance(cfg, dict):
            return normalize_thinking_mode(cfg.get("thinking_mode"))
    except Exception:
        pass
    return "auto"


def inject_thinking_mode(system_or_text: str, mode: str | None) -> str:
    block = thinking_mode_prompt_block(mode)
    if not block:
        return system_or_text or ""
    base = (system_or_text or "").rstrip()
    if not base:
        return block
    return f"{base}\n\n{block}"


def list_thinking_modes_public() -> list[dict[str, str]]:
    return [
        {"id": mid, "label": _MODE_LABELS[mid]}
        for mid in ("auto", "scientifique", "artiste", "philosophe", "enfant")
    ]
