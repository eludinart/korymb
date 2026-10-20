#!/usr/bin/env python3
"""Carte du jour Fleur d'Amôurs pour le cron Hermes.

Lit le catalogue public de l'app (texte officiel + chapitre du manuel)
et en choisit une par date, à Paris. La Braise a été publiée en boucle
jusqu'au 2026-10-19 : le cycle reprend à la carte suivante le 2026-10-20.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

CARDS_URL = "https://app-fleurdamours.eludein.art/jardin/api/data/all_cards.json"
MANIFEST_URL = "https://app-fleurdamours.eludein.art/jardin/manuel/manifest.json"
# Chapitre ouvert par l'app : /jardin/cartes/{fichier sans .md}
# /jardin/manuel/{fichier} sert le markdown brut, pas la carte.
LINK_BASE = "https://app-fleurdamours.eludein.art/jardin/cartes"
CACHE = Path(__file__).with_name("fleur-daily-card-cache.json")
# Dernier jour où le prompt du cron citait La Braise en dur.
ROTATION_START = date(2026, 10, 20)
BRAISE_SLUG = "la_braise"
SKIP_IDS = {
    "la-fleur-d-amours",
    "les-elements",
    "l-herbier-des-mots-cles",
    "remerciements-les-jardiniers-de-l-ame",
}
_SMALL = {"du", "de", "des", "et"}


def _fetch(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "hermes-fleur-daily-card"})
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"réponse inattendue: {url}")
    return payload


def _load_sources() -> tuple[dict, dict]:
    try:
        cards = _fetch(CARDS_URL)
        manifest = _fetch(MANIFEST_URL)
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError, TimeoutError):
        if not CACHE.exists():
            raise SystemExit("catalogue Fleur indisponible et aucun cache local")
        cached = json.loads(CACHE.read_text(encoding="utf-8"))
        return cached["cards"], cached["manifest"]
    try:
        CACHE.write_text(
            json.dumps({"cards": cards, "manifest": manifest}, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        # Le cache est un repli. Un fichier root:root ne doit pas empêcher le post.
        pass
    return cards, manifest


def _file_num(file_name: str) -> int:
    head = file_name.split("-", 1)[0]
    return int(head) if head.isdigit() else 0


def _is_card_section(section: dict) -> bool:
    section_id = str(section.get("id") or "")
    if section_id in SKIP_IDS or section_id.startswith("cycle-"):
        return False
    return 21 <= _file_num(str(section.get("file") or "")) <= 93


def _cap(word: str) -> str:
    if not word:
        return word
    return word[0].upper() + word[1:].lower()


def display_name(name: str) -> str:
    parts = name.split()
    out: list[str] = []
    for index, part in enumerate(parts):
        if index and part.lower() in _SMALL:
            out.append(part.lower())
            continue
        mark = next((item for item in ("’", "'") if part.startswith(("L" + item, "l" + item))), None)
        if mark:
            out.append("L" + mark + _cap(part[2:]))
        else:
            out.append(_cap(part))
    return " ".join(out)


def build_deck(cards_doc: dict, manifest: dict) -> list[dict]:
    cards = cards_doc.get("cards")
    sections = manifest.get("sections")
    if not isinstance(cards, list) or not isinstance(sections, list):
        raise SystemExit("catalogue Fleur illisible")
    chapters = [section for section in sections if isinstance(section, dict) and _is_card_section(section)]
    chapters.sort(key=lambda section: _file_num(str(section.get("file") or "")))
    if len(chapters) != len(cards) or not cards:
        raise SystemExit(f"catalogue divergent: {len(cards)} cartes, {len(chapters)} chapitres")
    if cards[0].get("slug") != "agape" or chapters[0].get("id") != "agape":
        raise SystemExit("ordre du catalogue modifié (début)")
    if cards[-1].get("slug") != "le_grand_passage" or chapters[-1].get("id") != "le-grand-passage":
        raise SystemExit("ordre du catalogue modifié (fin)")

    deck: list[dict] = []
    for card, chapter in zip(cards, chapters):
        info = card.get("info") or []
        quote = str(info[0]).strip() if info else ""
        file_name = str(chapter.get("file") or "")
        if not quote or not file_name.endswith(".md"):
            raise SystemExit(f"carte incomplète: {card.get('slug')}")
        deck.append(
            {
                "slug": str(card.get("slug") or ""),
                "name": display_name(str(card.get("name") or "")),
                "page": chapter.get("bookPage"),
                "quote": quote,
                "link": f"{LINK_BASE}/{file_name[:-3]}",
            }
        )
    return deck


def card_for(deck: list[dict], today: date) -> dict:
    try:
        braise = next(index for index, card in enumerate(deck) if card["slug"] == BRAISE_SLUG)
    except StopIteration:
        raise SystemExit("La Braise est absente du catalogue") from None
    delta = max(0, (today - ROTATION_START).days)
    return deck[(braise + 1 + delta) % len(deck)]


def main() -> None:
    cards_doc, manifest = _load_sources()
    deck = build_deck(cards_doc, manifest)
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    card = card_for(deck, today)
    print(f"Carte : {card['name']}")
    print(f"Page du manuel : {card['page']}")
    print(f"Lien : {card['link']}")
    print("Texte officiel, à citer tel quel, sans le réécrire :")
    print(f"« {card['quote']} »")


if __name__ == "__main__":
    main()
