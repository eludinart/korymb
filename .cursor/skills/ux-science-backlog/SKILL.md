---
name: ux-science-backlog
description: >-
  État fait/reste du backlog UX tâches, tri, Science documentaire et synthèse
  mémoire Korymb. À lire avant de reprendre ces sujets (pas avant chaque message).
---

# Backlog UX / Science / Mémoire (état code)

Mis à jour 2026-10-23 — hub Science entreprise (lecture + guide).

## Livré

1. **UX tâches** — toggle Répondre, Urgent/⋯ dans menu compact, aperçus markdown, ReplyComposer plus dense
2. **Tri combinable** — cases à cocher + critère « réponse en attente » (`taskSort.ts` v2)
3. **Science documentaire** — `knowledge_documents`, API `/business/knowledge-documents`, UI `/gestion/science`, docs liés projet, index Classique
4. **Mémoire** — contexte global + scrub PII, modes auto/frozen/disabled, garde-fou test SQLite
5. **Projets** — aperçu description markdown, section Documents liés science
6. **Hub Science** — `GET /business/science-overview` + `/gestion/science` en sections (identité, dirigeant, contexte extrait, fiches, docs, offres guide, migrate calendrier UI)

## Reliquats optionnels

- Aperçu PDF science dépend de l’auth cookie sur l’iframe preview
- Passe UX cosmétique restante sur pages hors Gestion / Aujourd’hui
- Édition inline des fiches entités depuis le hub (aujourd’hui : lecture + lien questionnaire)
