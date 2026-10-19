---
name: boucle-operationnelle
description: Runbook de la boucle Hermes → Korymb HITL → Cursor → Coolify → smoke Hermes → mémoire. Utiliser pour conduire un chantier de bout en bout.
icon: refresh-cw
color: green
---

# Boucle opérationnelle

Voir aussi `tronc/loop.md` et `second-cerveau`.

## Étapes (agent Cursor)

### 0. Préflight

- [ ] Repo cible identifié (`ecosystem-map`)
- [ ] Mission / décision Korymb liée **ou** brief prêt à coller dans `/inbox`
- [ ] Skills produit chargées

### 1. Brief

Remplir `tronc/templates/mission-from-cursor.md`.  
Si pas encore dans Korymb : utiliser `korymb-mission-bridge` (session cadrage ou ticket) **avec accord Éric** pour les écritures API.

### 2. Attendre HITL

Ne pas merger/deploy prod destructive tant que la décision n'est pas claire.  
Pour work-in-progress local : OK.

### 3. Implémenter

- Branche `cursor/…`
- Tests / smoke locaux (`/api/health`, lint du repo)
- Pas de secrets dans le commit

### 4. Ship

- Push → Coolify (selon guide du repo)
- Runbook : `tronc/runbooks/coolify-deploy.md`
- Signaler à Éric de vérifier Hermes smoke / cron post-deploy

### 5. Fermer (concert)

- Écrire la fiche : `scripts/record-change.*` **ou** `tronc/templates/outcome-log.md`
- Idéalement `--hermes --korymb` pour que les deux autres nœuds voient le changement
- Voir `tronc/runbooks/concert-partage.md` + `closed-loop.md` + skill `memoire-outcomes`

## Si tu es invoqué mid-flight

Reprendre à l'étape la plus basse non cochée ; ne pas recommencer le cadrage sans besoin.
