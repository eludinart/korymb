"""Réponse locale quand le fournisseur LLM est injoignable (crédit, quota, délai, 5xx)."""
from __future__ import annotations

import re

import httpx

# Préfixe conservé dans le texte stocké. L'UI le retire et affiche un badge.
DEGRADED_MARKER = "[[korymb-degraded]]"

_HARD_QUOTA = re.compile(
    r"402|payment required|billing|insufficient|quota|credit|crédit|solde|balance|"
    r"exceeded your|plan limit|out of credits|invalid api key|unauthorized|401",
    re.I,
)
_TIMEOUT = re.compile(r"timeout|timed out|délai dépassé|read timed", re.I)
_UPSTREAM = re.compile(
    r"\bHTTP (?:500|502|503|504)\b|service unavailable|bad gateway|overloaded|capacity",
    re.I,
)
_IDENTITY = re.compile(
    r"qui (?:es|est|êtes|etes)[-\s]?(?:tu|vous)|tu es qui|qui suis-je|"
    r"présente[-\s]?toi|presente[-\s]?toi|c['’]est qui",
    re.I,
)


def llm_outage_kind(exc: BaseException | None) -> str | None:
    """quota = crédit, clé ou facturation ; timeout = délai ; upstream = 5xx. None sinon."""
    if exc is None:
        return None
    if isinstance(exc, (TimeoutError, httpx.TimeoutException)):
        return "timeout"
    msg = str(exc)
    if _HARD_QUOTA.search(msg):
        return "quota"
    if _TIMEOUT.search(msg):
        return "timeout"
    if _UPSTREAM.search(msg):
        return "upstream"
    return None


def llm_outage_is_hard(kind: str | None) -> bool:
    """Le modèle ne répondra pas : inutile de lancer une mission qui va échouer pareil."""
    return kind == "quota"


def llm_outage_reason(exc: BaseException | None) -> str:
    kind = llm_outage_kind(exc)
    if kind == "quota":
        return "Le crédit, le quota ou la clé du modèle est indisponible."
    if kind == "timeout":
        return "Le modèle n'a pas répondu à temps."
    if kind == "upstream":
        return "Le fournisseur du modèle a renvoyé une erreur."
    return "Le modèle est momentanément indisponible."


def degraded_chat_reply(
    message: str,
    *,
    agent_label: str = "Korymb",
    reason: str | None = None,
) -> str:
    """Réponse utile sans appel LLM, avec un signal explicite de mode dégradé."""
    why = (reason or "Le modèle est momentanément indisponible.").strip()
    notice = (
        f"{DEGRADED_MARKER}\n"
        f"**Mode dégradé** — {why} "
        "Cette réponse est locale, sans appel au modèle."
    )
    msg = (message or "").strip()
    label = (agent_label or "Korymb").strip() or "Korymb"
    if _IDENTITY.search(msg):
        return (
            f"{notice}\n\n"
            f"Je suis **{label}**, dans la plateforme Korymb. "
            "En temps normal je m'appuie sur le modèle configuré pour répondre et lancer des missions. "
            "Là, je ne peux pas l'interroger. "
            "Vérifiez le crédit du fournisseur dans **Administration → LLM**, puis renvoyez votre message."
        )
    preview = msg[:280] + ("…" if len(msg) > 280 else "")
    received = f"J'ai bien reçu : « {preview} ».\n\n" if preview else ""
    return (
        f"{notice}\n\n"
        f"{received}"
        "Je ne peux pas traiter cette demande tant que le modèle est indisponible. "
        "La conversation est conservée : renvoyez le message dès que le service est rétabli."
    )
