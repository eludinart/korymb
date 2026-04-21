---
name: codebase
description: Cartographie et explique un codebase de façon approfondie (architecture, points d'entree, flux, dependances, risques, impact des changements). Utiliser pour toute demande d'analyse de codebase, onboarding technique, "ou est quoi", ou estimation d'impact avant modification.
---

# Codebase Analysis

## Objectif

Produire une lecture fiable et actionnable du codebase, en priorisant:
- structure globale et responsabilites par zone
- points d'entree runtime
- flux metier et flux de donnees
- zones de risque et dette technique
- impact probable d'un changement demande

## Mode de travail

1. Commencer par une cartographie rapide des dossiers et des apps/services.
2. Identifier les points d'entree d'execution (front, backend, scripts, jobs).
3. Relier les fonctionnalites metier aux fichiers qui les portent.
4. Verifier les hypotheses avec des references de code concretes.
5. Conclure avec impacts, risques, et plan d'action propose.

## Checklist d'exploration

- [ ] Dossiers principaux et role de chacun
- [ ] Frameworks/outils utilises (build, routing, state, API)
- [ ] Entrypoints (`main`, `App`, `server`, routes API, scripts)
- [ ] Couche configuration (`.env`, settings, runtime flags)
- [ ] Front ↔ API: clients, endpoints, auth, erreurs
- [ ] Ecrans/fonctionnalites critiques et leurs fichiers
- [ ] Points de couplage fort / duplication
- [ ] Risques de regression en cas de changement

## Format de reponse (profond)

Utiliser cette structure:

```markdown
## Vue d'ensemble
- ...

## Architecture
- ...

## Points d'entree
- ...

## Flux metier et donnees
- ...

## Fichiers cles
- `path/a`
- `path/b`

## Risques et dette
- ...

## Impact analysis (si demande de modif)
- Changement vise:
- Fichiers impactes:
- Effets de bord probables:
- Verifications/tests recommandes:

## Recommandations
- ...
```

## Regles de qualite

- Toujours citer les chemins de fichiers exacts.
- Ne pas inventer de comportements non verifies.
- Distinguer clairement **fait observe** vs **hypothese**.
- En cas d'incertitude, proposer la verification precise a faire.
- Favoriser des recommandations incrementales et testables.

## Onboarding rapide

Quand la demande ressemble a "explique le projet":
1. Donner une vue systeme en 5-8 bullets max.
2. Donner la "roadmap de lecture" (ordre de fichiers a lire).
3. Donner les commandes minimales pour lancer/verifier.
4. Donner les 3 zones les plus fragiles du codebase.

## Impact analysis

Quand la demande est "si on change X":
1. Identifier la source de verite de X.
2. Remonter les usages directs.
3. Evaluer les impacts transverses (UI, API, config, data).
4. Proposer un plan de changement en etapes courtes.
5. Inclure un mini plan de validation.

## Sortie attendue

Une analyse en francais, detaillee mais lisible, avec:
- priorisation claire (du plus important au moins important)
- references fichiers
- prochaines actions concretes
