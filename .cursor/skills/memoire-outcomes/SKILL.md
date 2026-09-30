---
name: memoire-outcomes
description: Consolider les outcomes de missions (commit, deploy, smoke, appris) dans le tronc et les mémoires Hermes/Korymb. Fermer la boucle du second cerveau.
icon: archive
color: orange
---

# Mémoire outcomes

Sans outcome, la boucle **ne s'améliore pas**.

## Quand

Après merge/deploy, abandon de mission, ou incident résolu.

## Comment

1. Remplir `tronc/templates/outcome-log.md` (ou `tronc/outcomes/YYYY-MM-DD-<slug>.md`).
2. Proposer à Éric :
   - Append dans Hermes `decisions-eric.md` section Outcomes (via sync ou collage WebUI)
   - Si décision durable : aussi dans mémoire Korymb workspace
3. Si le dépôt banque-skills est ouvert : commit l'outcome sous `tronc/outcomes/` (sans secrets).

## Contenu obligatoire

- Lien mission / job / inbox
- Commit ou PR
- Smoke OK/FAIL
- **1 appris** actionnable

## Ne pas

- Coller tokens, mots de passe, dumps PII
- Réécrire tout `decisions-eric.md` — **append** seulement
