#!/usr/bin/env bash
# Carte du jour — Tarot Fleur d'Amôurs.
# Tirage déterministe (Europe/Paris) sur l'ordre figé de fleur-deck.json.
# Usage : fleur-card-of-day.sh [--date YYYY-MM-DD] [--text|--json]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECK="${FLEUR_DECK_FILE:-$ROOT/fleur-deck.json}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Erreur: python3 introuvable." >&2
  exit 1
fi

exec python3 - "$DECK" "$@" << 'PY'
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo


def fail(message: str, code: int) -> None:
    print(f"Erreur: {message}", file=sys.stderr)
    raise SystemExit(code)


def usage() -> None:
    print(
        "Usage: fleur-card-of-day.sh [--date YYYY-MM-DD] [--text|--json]",
        file=sys.stderr,
    )
    raise SystemExit(2)


deck_path = sys.argv[1]
args = sys.argv[2:]
mode = "json"
wanted: str | None = None
index = 0
while index < len(args):
    arg = args[index]
    if arg in ("-h", "--help"):
        usage()
    elif arg == "--text":
        mode = "text"
    elif arg == "--json":
        mode = "json"
    elif arg == "--date":
        if index + 1 >= len(args):
            usage()
        wanted = args[index + 1]
        index += 1
    elif arg.startswith("--date="):
        wanted = arg.split("=", 1)[1]
    else:
        usage()
    index += 1

try:
    with open(deck_path, encoding="utf-8") as handle:
        deck = json.load(handle)
except FileNotFoundError:
    fail(f"jeu introuvable ({deck_path}).", 1)

cards = deck.get("cards") or []
if not cards:
    fail("jeu vide.", 1)

try:
    epoch = date.fromisoformat(deck["epoch"])
except (KeyError, ValueError):
    fail("epoch du jeu invalide.", 1)

tz_name = deck.get("timezone") or "Europe/Paris"
if wanted is None:
    today = datetime.now(ZoneInfo(tz_name)).date()
else:
    try:
        today = date.fromisoformat(wanted)
    except ValueError:
        fail("date attendue au format YYYY-MM-DD.", 2)

count = len(cards)
slot = (today - epoch).days % count
card = cards[slot]
template = deck.get("url_template") or "https://app-fleurdamours.eludein.art/cycles/{cycle}#{slug}"
payload = {
    "date": today.isoformat(),
    "timezone": tz_name,
    "deck_size": count,
    "index": slot,
    "name": card["name"],
    "cycle": card["cycle"],
    "slug": card["slug"],
    "url": template.format(cycle=card["cycle"], slug=card["slug"]),
    "quote": card.get("quote") or "",
    "page": card.get("page") or "",
}

if mode == "text":
    for key in ("date", "name", "cycle", "slug", "url", "quote", "page"):
        print(f"{key}: {payload[key]}")
else:
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
PY
