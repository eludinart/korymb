#!/usr/bin/env python3
"""Régénère ops/hermes-scripts/fleur-deck.json depuis un clone de fleur-amours.

Source (lecture seule) :
  next/public/manuel/<chapitre>.md  — question racine + pages livre
  next/src/data/tarotCards.ts       — nom affiché dans l'app

L'ordre du tableau `cards` est un mélange figé (graine fleur-damours-carte-du-jour-v1).
Relancer ce script met à jour les champs des slugs déjà présents et n'ajoute
en queue que les cartes nouvelles. Il ne remélange pas le jeu.

Usage :
  python3 ops/hermes-scripts/regen-fleur-deck.py /chemin/vers/fleur-amours
"""

from __future__ import annotations

import json
import random
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

SEED = "fleur-damours-carte-du-jour-v1"
EPOCH = "2026-01-01"
HERE = Path(__file__).resolve().parent
OUT = HERE / "fleur-deck.json"

# Chapitres d'introduction, pas des cartes.
SKIP_STEMS = {
    "cycle-du-vegetal",
    "les-elements",
    "cycle-de-la-terre",
    "cycle-de-l-eau",
    "cycle-de-l-air",
    "cycle-du-feu",
    "cycle-de-l-ether",
    "cycle-de-la-vie",
}


def fold(value: str) -> str:
    text = value.replace("œ", "oe").replace("Œ", "oe").replace("æ", "ae").replace("Æ", "ae")
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def cycle_for(chapter: int) -> str:
    if 21 <= chapter <= 28:
        return "coeur"
    if 30 <= chapter <= 39:
        return "vegetal"
    if chapter == 41 or 68 <= chapter <= 73:
        return "feu"
    if chapter == 42 or 75 <= chapter <= 80:
        return "ether"
    if chapter == 43 or 54 <= chapter <= 59:
        return "eau"
    if chapter == 44 or 61 <= chapter <= 66:
        return "air"
    if chapter == 45 or 47 <= chapter <= 52:
        return "terre"
    if 82 <= chapter <= 93:
        return "vie"
    raise ValueError(f"chapitre hors jeu : {chapter}")


def clean_quote(raw: str) -> str:
    quote = raw.strip()
    quote = re.sub(r"^[«\"“\s]+|[»\"”\s]+$", "", quote)
    quote = re.sub(r"\s+", " ", quote).strip()
    return quote


def load_names(tarot_ts: Path) -> dict[str, str]:
    names = re.findall(r"name:\s*(?:'([^']+)'|\"([^\"]+)\")", tarot_ts.read_text(encoding="utf-8"))
    ordered: list[str] = []
    for left, right in names:
        name = left or right
        if name not in ordered:
            ordered.append(name)
    index: dict[str, str] = {}
    for name in ordered:
        index.setdefault(fold(name), name)
        index.setdefault(fold(name).replace("oe", ""), name)
    return index


def git_commit(repo: Path) -> str:
    try:
        out = subprocess.check_output(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""
    return out.strip()


def collect(repo: Path) -> list[dict[str, str]]:
    manuel = repo / "next" / "public" / "manuel"
    tarot = repo / "next" / "src" / "data" / "tarotCards.ts"
    if not manuel.is_dir() or not tarot.is_file():
        raise SystemExit(f"Clone fleur-amours incomplet : {repo}")
    names = load_names(tarot)
    cards: list[dict[str, str]] = []
    for path in sorted(manuel.glob("[0-9][0-9]-*.md")):
        chapter = int(path.name.split("-", 1)[0])
        if not 21 <= chapter <= 93:
            continue
        slug = path.stem.split("-", 1)[1]
        if slug in SKIP_STEMS:
            continue
        text = path.read_text(encoding="utf-8")
        page_match = re.search(r"Pages livre \(sommaire\)\s*:\s*([0-9]+(?:[–—-][0-9]+)?)", text)
        quote_match = re.search(r"Question Racine\s*:\s*(.+)", text)
        if not page_match or not quote_match:
            raise SystemExit(f"Page ou question racine absente : {path.name}")
        name = names.get(fold(slug)) or names.get(fold(slug).replace("oe", ""))
        if not name:
            raise SystemExit(f"Nom d'app introuvable pour {slug}")
        cards.append(
            {
                "name": name,
                "cycle": cycle_for(chapter),
                "slug": slug,
                "quote": clean_quote(quote_match.group(1)),
                "page": page_match.group(1).replace("–", "-").replace("—", "-"),
            }
        )
    if len(cards) != 65:
        raise SystemExit(f"Jeu attendu : 65 cartes, obtenu : {len(cards)}")
    slugs = [card["slug"] for card in cards]
    if len(set(slugs)) != len(slugs):
        raise SystemExit("Slugs en double dans le manuel")
    return cards


def freeze_order(cards: list[dict[str, str]]) -> list[dict[str, str]]:
    by_slug = {card["slug"]: card for card in cards}
    previous: list[str] = []
    if OUT.is_file():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        previous = [card["slug"] for card in old.get("cards", []) if card.get("slug") in by_slug]
    ordered = [by_slug[slug] for slug in previous]
    fresh = [card for card in cards if card["slug"] not in set(previous)]
    if fresh and not previous:
        random.Random(SEED).shuffle(fresh)
    elif fresh:
        random.Random(SEED).shuffle(fresh)
    ordered.extend(fresh)
    return ordered


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: regen-fleur-deck.py /chemin/vers/fleur-amours")
    repo = Path(sys.argv[1]).resolve()
    cards = freeze_order(collect(repo))
    payload = {
        "source": {
            "repo": "https://github.com/eludinart/fleur-amours",
            "commit": git_commit(repo),
            "names": "next/src/data/tarotCards.ts",
            "quotes_and_pages": "next/public/manuel/*.md (Question Racine + Pages livre)",
            "cycles": "chapitres du manuel : coeur 21-28, vegetal 30-39, elements bruts 41-45, terre 47-52, eau 54-59, air 61-66, feu 68-73, ether 75-80, vie 82-93",
            "db": "pas de catalogue de cartes dans les tables wp_fleur_* (comptes, tirages, coach)",
        },
        "epoch": EPOCH,
        "timezone": "Europe/Paris",
        "shuffle_seed": SEED,
        "url_template": "https://app-fleurdamours.eludein.art/cycles/{cycle}#{slug}",
        "cards": cards,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT} : {len(cards)} cartes, commit {payload['source']['commit'] or 'inconnu'}")


if __name__ == "__main__":
    main()
