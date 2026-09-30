"""Garde-fou anti-dérive thématique (CRM / prospection hors sujet)."""
from __future__ import annotations

import re
import unicodedata

from services.chat_intelligence import INTENT_CRM, INTENT_STATUS, classify_chat_intent

_FALLBACK = (
    "Je me suis écarté du sujet (contenu CRM / prospection hors contexte). "
    "Reformulez votre demande pour l'équipe ou le fil en cours — "
    "sans fiches Gestion ni tableau de prospection — et je réponds uniquement là-dessus."
)

# Signaux forts : un seul suffit souvent ; deux = dérive certaine.
_STRONG_CRM = re.compile(
    r"(?i)\b("
    r"tableau de prospection|fiches?\s+crm|gestion_propose_contact|"
    r"gestion_upsert_contact|gestion_search_contacts|"
    r"questions?\s+strat[eé]giques?\s+du\s+cio|"
    r"synth[eè]se\s+d[eé]cisionnelle|"
    r"enrichissement\s+(e-?mail|email|t[eé]l[eé]phone|contact)|"
    r"/gestion/playbooks|playbook\s+e-?mail|"
    r"contacts?\s+r[eé]serve|prospection\s+(web|gmail|linkedin)"
    r")\b"
)

_WEAK_CRM = re.compile(
    r"(?i)\b("
    r"prospect(?:s|ion)?|crm|relance(?:r)?\s+les?\s+contacts?|"
    r"fiche\s+contact|upsert_contact|coach(?:s|es)?\s+martin|"
    r"d[eé]cisions?\b.{0,40}\bcrm|inbox\s+hitl.{0,30}contact"
    r")\b"
)

_USER_CRM_OK = re.compile(
    r"(?i)\b("
    r"crm|prospect|prospection|contact|contacts|devis|coach|relance|"
    r"enrich|gestion|d[eé]cisions?|inbox|fiche"
    r")\b"
)


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def user_invites_crm_topic(user_text: str) -> bool:
    """True si le message dirigeant autorise une réponse CRM / Gestion."""
    raw = (user_text or "").strip()
    if not raw:
        return False
    intent = classify_chat_intent(raw)
    if intent in (INTENT_CRM, INTENT_STATUS):
        # STATUS : on laisse passer overview, mais pas un pavé prospection.
        if intent == INTENT_STATUS and not _USER_CRM_OK.search(_fold(raw)):
            return False
        if intent == INTENT_CRM:
            return True
    return bool(_USER_CRM_OK.search(_fold(raw)))


def crm_drift_score(reply: str) -> int:
    """Score de dérive CRM dans une réponse assistant (0 = OK)."""
    text = (reply or "").strip()
    if not text:
        return 0
    score = 0
    if _STRONG_CRM.search(text):
        score += 2
    weak_hits = len(_WEAK_CRM.findall(text))
    if weak_hits >= 2:
        score += 2
    elif weak_hits == 1:
        score += 1
    # Pavé long centré prospection même sans marqueur fort unique.
    folded = _fold(text)
    if len(text) > 500 and folded.count("prospect") + folded.count("crm") + folded.count("contact") >= 4:
        score += 2
    return score


def reply_is_crm_drift(reply: str, *, user_text: str = "") -> bool:
    if user_invites_crm_topic(user_text):
        return False
    return crm_drift_score(reply) >= 2


def strip_crm_blocks(reply: str) -> str:
    """Retire les blocs CRM les plus bruyants ; peut laisser un reste utile."""
    text = (reply or "").strip()
    if not text:
        return text
    text = re.sub(
        r"(?ms)^#{1,3}\s+Synth[eè]se\s+d[eé]cisionnelle\b.*?(?=^#{1,3}\s|\Z)",
        "",
        text,
    ).strip()
    text = re.sub(
        r"(?ms)^(?:\*{0,2}|_{0,2}|#{1,3}\s*)?QUESTIONS?\s+STRAT[EÉ]GIQUES?(?:\s+DU\s+CIO)?.*?(?=^#{1,3}\s|\Z)",
        "",
        text,
    ).strip()
    text = re.sub(r"(?ms)\n####\s+LIVRABLE[^\n]*prospection.*$", "", text, flags=re.I).strip()
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def guard_chat_reply(
    reply: str | None,
    *,
    user_text: str = "",
    agent_group_id: str | None = None,
) -> tuple[str, bool]:
    """
    Blinden la réponse chat contre une dérive CRM hors sujet.

    Retourne (texte_sûr, drifted).
    `agent_group_id` non-entreprise : seuil plus bas (équipe projet).
    """
    text = (reply or "").strip()
    if not text:
        return text, False
    if user_invites_crm_topic(user_text):
        return text, False

    project_team = False
    gid = (agent_group_id or "").strip()
    if gid and gid != "entreprise":
        try:
            from services.agent_groups import group_memory_scope

            project_team = group_memory_scope(gid) != "enterprise"
        except Exception:
            project_team = True

    score = crm_drift_score(text)
    threshold = 1 if project_team else 2
    if score < threshold:
        return text, False

    cleaned = strip_crm_blocks(text)
    # Si après découpe il reste encore trop de CRM, ou presque rien : fallback.
    if crm_drift_score(cleaned) >= threshold or len(cleaned) < 40:
        return _FALLBACK, True
    # Reste un peu de CRM faible : on ajoute un avertissement court.
    if crm_drift_score(cleaned) >= 1:
        return (
            cleaned
            + "\n\n_(J'ai retiré un bloc CRM/prospection hors sujet. "
            "Reformulez si vous vouliez parler Gestion.)_",
            True,
        )
    return cleaned, True


def crm_tools_allowed_for_chat(*, user_text: str, agent_group_id: str | None) -> bool:
    """Les outils gestion_* ne sont autorisés en chat que si le sujet y invite."""
    if user_invites_crm_topic(user_text):
        return True
    gid = (agent_group_id or "").strip()
    if not gid or gid == "entreprise":
        # CIO flotte : encore non, sauf invitation explicite (déjà False ici).
        return False
    return False
