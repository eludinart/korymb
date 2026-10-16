"""Routage des demandes par catégorie — Korymb / Classique / concertation / Eric.

Règles décidées avec Eric :
  (a) métier pur            -> korymb
  (b) perso et technique    -> classique
  (c) mixte                 -> concertation (les deux agents)
  (d) indéterminé           -> eric (repli par défaut)

Une catégorie explicite valide l'emporte toujours. Sinon, détection par mots-clés
sur intent + texte du payload. Fonction pure, sans I/O : testable isolément.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

CATEGORY_BUSINESS = "business"
CATEGORY_PERSONAL_TECHNICAL = "personal_technical"
CATEGORY_MIXED = "mixed"
CATEGORY_UNDETERMINED = "undetermined"

TARGET_BY_CATEGORY: dict[str, str] = {
    CATEGORY_BUSINESS: "korymb",
    CATEGORY_PERSONAL_TECHNICAL: "classique",
    CATEGORY_MIXED: "concertation",
    CATEGORY_UNDETERMINED: "eric",
}

CATEGORY_ALIASES: dict[str, str] = {
    "business": CATEGORY_BUSINESS,
    "metier": CATEGORY_BUSINESS,
    "a": CATEGORY_BUSINESS,
    "personal_technical": CATEGORY_PERSONAL_TECHNICAL,
    "personal": CATEGORY_PERSONAL_TECHNICAL,
    "perso": CATEGORY_PERSONAL_TECHNICAL,
    "technical": CATEGORY_PERSONAL_TECHNICAL,
    "technique": CATEGORY_PERSONAL_TECHNICAL,
    "b": CATEGORY_PERSONAL_TECHNICAL,
    "mixed": CATEGORY_MIXED,
    "mixte": CATEGORY_MIXED,
    "c": CATEGORY_MIXED,
    "undetermined": CATEGORY_UNDETERMINED,
    "indetermine": CATEGORY_UNDETERMINED,
    "unknown": CATEGORY_UNDETERMINED,
    "d": CATEGORY_UNDETERMINED,
}

BUSINESS_KEYWORDS = (
    "client", "clients", "prospect", "prospection", "devis", "facture", "factures", "crm",
    "contact", "seance", "seances", "atelier", "formation", "vitrine", "participant",
    "participants", "playbook", "mission", "fleur", "mandala", "sivana", "commercial",
    "vente", "ventes", "relance", "newsletter", "campagne", "inscription", "tarot",
)
PERSONAL_TECHNICAL_KEYWORDS = (
    "perso", "personnel", "personnelle", "famille", "sante", "medecin", "bateau",
    "voilier", "openplotter", "raspberry", "vacances", "courses", "maison",
    "deploiement", "deployer", "deploy", "serveur", "vps", "coolify", "docker", "git",
    "github", "bug", "code", "dns", "ssl", "backup", "sauvegarde", "script", "cursor",
    "hermes", "api", "base de donnees", "mariadb", "linux",
)


def _norm(text: str) -> str:
    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def normalize_category(raw: Any) -> str | None:
    if raw is None:
        return None
    key = _norm(str(raw)).strip().replace("-", "_").replace(" ", "_")
    return CATEGORY_ALIASES.get(key)


def _flatten(payload: Any) -> str:
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        return " ".join(_flatten(v) for v in payload.values())
    if isinstance(payload, (list, tuple)):
        return " ".join(_flatten(v) for v in payload)
    return str(payload)


def _hits(text: str, words: tuple[str, ...]) -> list[str]:
    found = []
    for w in words:
        if re.search(rf"(?<![a-z0-9]){re.escape(w)}(?![a-z0-9])", text):
            found.append(w)
    return found


def route(*, category: Any = None, intent: str = "", payload: Any = None) -> dict[str, Any]:
    """Retourne {category, target, source, reason, matched}."""
    explicit = normalize_category(category)
    if explicit:
        return {
            "category": explicit,
            "target": TARGET_BY_CATEGORY[explicit],
            "source": "explicit",
            "reason": f"Catégorie explicite « {explicit} ».",
            "matched": {"business": [], "personal_technical": []},
        }
    text = _norm(f"{intent or ''} {_flatten(payload)}")
    biz = _hits(text, BUSINESS_KEYWORDS)
    tech = _hits(text, PERSONAL_TECHNICAL_KEYWORDS)
    if biz and tech:
        cat, reason = CATEGORY_MIXED, "Mots-clés métier et perso/technique présents."
    elif biz:
        cat, reason = CATEGORY_BUSINESS, "Mots-clés métier uniquement."
    elif tech:
        cat, reason = CATEGORY_PERSONAL_TECHNICAL, "Mots-clés perso/technique uniquement."
    else:
        cat, reason = CATEGORY_UNDETERMINED, "Aucun indice : repli sur Eric."
    return {
        "category": cat,
        "target": TARGET_BY_CATEGORY[cat],
        "source": "keywords",
        "reason": reason,
        "matched": {"business": biz, "personal_technical": tech},
    }
