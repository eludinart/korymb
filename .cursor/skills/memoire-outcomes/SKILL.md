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

1. **Préférer** le script concert (écrit local + option Hermes + Korymb d’un coup) :

```bash
./scripts/record-change.sh --title "…" --summary "…" --source cursor \
  --repo <repo> --commit <sha> --hermes --korymb
```

```powershell
.\scripts\record-change.ps1 -Title "…" -Summary "…" -Source cursor -Hermes -Korymb
```

2. Sinon remplir `tronc/templates/outcome-log.md` → `tronc/outcomes/YYYY-MM-DD-<slug>.md`.
3. Append Hermes `decisions-eric.md` (script ou collage) ; décision durable → aussi mémoire Korymb.
4. Commit l’outcome sous `tronc/outcomes/` si le dépôt tronc est ouvert (sans secrets).

Règle : **sans fiche, les autres nœuds ne voient pas le changement.**

## Contenu obligatoire

- Lien mission / job / inbox
- Commit ou PR
- Smoke OK/FAIL
- **1 appris** actionnable

## Ne pas

- Coller tokens, mots de passe, dumps PII
- Réécrire tout `decisions-eric.md` — **append** seulement
