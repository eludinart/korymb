#!/usr/bin/env python3
"""60+ jours consécutifs : pas de doublon adjacent, couverture du jeu entier."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "fleur-card-of-day.sh"
DECK = json.loads((ROOT / "fleur-deck.json").read_text(encoding="utf-8"))


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        check=False,
        capture_output=True,
        text=True,
    )


def card_on(day: date) -> dict:
    proc = run("--date", day.isoformat())
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def main() -> None:
    epoch = date.fromisoformat(DECK["epoch"])
    deck_slugs = [card["slug"] for card in DECK["cards"]]
    assert len(deck_slugs) == len(set(deck_slugs)) == 65

    slugs: list[str] = []
    for offset in range(130):
        day = epoch + timedelta(days=offset)
        payload = card_on(day)
        assert payload["date"] == day.isoformat()
        assert payload["deck_size"] == 65
        assert payload["name"]
        assert payload["quote"]
        assert payload["page"]
        assert payload["url"] == (
            f"https://app-fleurdamours.eludein.art/cycles/{payload['cycle']}#{payload['slug']}"
        )
        slugs.append(payload["slug"])

    for start in (0, 65):
        window = slugs[start : start + 65]
        assert len(window) == len(set(window)) == 65
        assert set(window) == set(deck_slugs)

    sixty = slugs[10:70]
    assert len(sixty) == 60
    assert all(left != right for left, right in zip(sixty, sixty[1:]))
    assert all(left != right for left, right in zip(slugs, slugs[1:]))

    assert card_on(epoch + timedelta(days=3))["slug"] == slugs[3]
    before = card_on(epoch - timedelta(days=1))
    assert before["slug"] == slugs[-1]
    assert before["slug"] != slugs[0]

    text = run("--date", epoch.isoformat(), "--text")
    assert text.returncode == 0, text.stderr
    assert f"slug: {slugs[0]}" in text.stdout
    assert "url: https://app-fleurdamours.eludein.art/cycles/" in text.stdout

    bad = run("--date", "2026-13-01")
    assert bad.returncode == 2
    assert "Erreur:" in bad.stderr

    print("ok 130 jours, couverture 65, aucun doublon consécutif")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"échec: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
