# Mission — Mode Cerveau (friction UX)

**Repo :** github.com/eludinart/korymb  
**Statut :** P1 → P4 livrés (local) — HITL prod non requis pour WIP  

## Objectif

Réduire la friction cognitive de Korymb sans abandonner le HITL sur les actions sensibles (envoi, publish, paiement).

Contrat cible : **intention → exécution** ; **mémoire autonome + correction rare** ; **Décisions rares et denses**.

## Acceptance criteria (P1–P3) ✓

Voir historique ci-dessous / commits Mode Cerveau.

## Acceptance criteria (P4) ✓

1. **Surfaces adaptatives** — bascule Flux / Kanban / Carte / Scénarios (`WorkSurfaceSwitcher`) avec suggestion selon charge + mode de pensée.
2. **Kanban missions** — `/missions?view=kanban` (colonnes En cours / À valider / Livré / Bloqué).
3. **Scénarios multi-horizons** — `POST /admin/scenarios/simulate` + panneau « Et si… » (1 / 5 / 10 ans) sur le briefing.

**Hors scope P4 :** HITL Telegram (déjà existant), voix expressive TTS.

## Preuves

- `backend/tests/test_scenario_sim.py`
- Smoke : `/briefing` (surfaces + scénarios), `/missions?view=kanban`, `/carte`

## Suite (P5+)

- Adaptation full (mind-map éditable, storyboard).
- Voix / BCI.
- HITL Telegram one-tap raffiné.
