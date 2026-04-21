# Plan De Bascule Immediat Vers Next.js

## Objectif

Basculer vers un front Next.js unique sans casser la production, en conservant le backend FastAPI.

## Semaine 1 - Fondations

1. Creer `web-next/` (ou reutiliser `admin/`) comme front unique.
2. Poser une couche API cliente partagee (`requestJson`, auth header, cache policy no-store).
3. Activer React Query + Query keys communes (`llm`, `tokens`, `jobs`, `job-detail`, `memory`, `agents`).
4. Brancher SSE `GET /events/stream` pour hydrater le cache client.

Definition of Done:
- Header LLM + tokens se mettent a jour sans reload.
- Ecran config stable avec invalidation automatique.

## Semaine 2 - Migration Ecrans Critiques

1. Migrer `Configuration` puis `Administration`.
2. Migrer `Mission guidee`.
3. Migrer `Dashboard missions/chat/historique`.
4. Conserver routes Vite en fallback tant que chaque ecran n'est pas valide.

Definition of Done:
- Chaque ecran migre dispose de tests e2e basiques (ouvrir, action principale, refresh live).
- Pas de fetch brut dans ecrans migres.

## Semaine 3 - Cutover

1. Basculer routing principal vers Next.js.
2. Rediriger anciennes routes Vite vers nouvelles routes Next.
3. Supprimer code Vite ecran par ecran apres verification.
4. Garder rollback simple via flag d'environnement (`FRONT_TARGET=vite|next`).

Definition of Done:
- Next devient front par defaut.
- Rollback documente et teste.

## Regles De Stabilite Pendant La Migration

- Une seule source de verite par type de donnee (React Query cache).
- Invalidation obligatoire apres mutation.
- Polling intelligent: actif seulement onglet visible.
- SSE prioritaire pour le temps reel, polling en fallback.
- Timeout/retry/no-cache uniformes pour toutes les requetes.
