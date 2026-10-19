"""Recalcule les vecteurs du journal avec l'encodeur courant.

À lancer une fois après le passage de KORYMB_EMBED_PROVIDER=hash à un vrai
modèle (les anciens vecteurs « hash » ne sont pas comparables) :

    cd backend && python scripts/reembed_traces.py [--only-conversations] [--limit 5000]

Équivalent HTTP : POST /classique/memory/reembed (clé Classique).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only-conversations", action="store_true")
    parser.add_argument("--limit", type=int, default=5000)
    args = parser.parse_args()
    try:
        from env_loader import load_backend_env

        load_backend_env()
    except Exception:
        pass
    from services.conversation_memory import MEMORY_KIND
    from services.trace_vectors import reembed_traces

    out = reembed_traces(limit=args.limit, kinds=[MEMORY_KIND] if args.only_conversations else None)
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
