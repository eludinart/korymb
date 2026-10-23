# Couche coaching unifiée Korymb

> **For agentic workers:** exécuter phase par phase ; chaque phase livre quelque chose de testable. Méthodes internes (SMART / GTD / Eisenhower / time blocking) **jamais** en titre UI.

**Goal:** Relier cible → capture → tri → agenda dans Korymb, avec les **bonnes données aux bons endroits**, en langage courant.

**Architecture:** Réutiliser `biz_projects` / jalons, `biz_work_tasks`, `biz_calendar_events`, science/contexte. Ajouter le minimum de champs pour relier les couches. L’IA propose ; HITL valide. `/inbox` reste **Décisions agents**, distinct de « Ce qui traîne ».

**Tech stack:** FastAPI (`work_tasks.py`, `business_db.py`, `director_platform.py`) + Next admin (`BriefingBoard`, `WorkTaskList`, planning, science).

## Contraintes de nommage

| Méthode (interne / aide) | Titre UI visible | Sous-texte optionnel |
|---|---|---|
| SMART | **Où je vais** | Cible claire, mesurable, datée |
| GTD | **Ce qui traîne** | Tout noter sans trier |
| Eisenhower | **Quoi d’abord** | Urgent vs important |
| Time blocking | **Quand je le fais** | Placer dans mon agenda |

- **Titre visible** = langage courant uniquement.
- **Méthode** = tooltip, « En savoir plus », ou commentaire produit — pas le H2.
- HITL `/inbox` = **Décisions** (ou « À valider ») — **jamais** « inbox GTD » / capture personnelle.
- Pas de 4 apps silo ; filtres / sections sur surfaces existantes.
- Pas de time blocking auto écrit sans validation.
- Ne pas bloquer sur le backlog UX déjà livré (tâches / science / mémoire).

## Cartographie données (inclure / exclure)

| Section | Inclure | Exclure |
|--------|---------|---------|
| **Où je vais** | Projets actifs, jalons ouverts, science liée, contexte confirmé | HITL, `task.urgent` seul, créneaux |
| **Ce qui traîne** | Tâches open sans projet (capture), notes vrac ; courrier « à trier » si utile plus tard | `/inbox` HITL, jalons structurés, events |
| **Quoi d’abord** | Tâches clarifiées + `urgent` + importance (lien objectif) + P* jalons | Capture brute, severity HITL (→ Décisions) |
| **Quand je le fais** | `due_at`, events liés tâche/focus, anticipation hors bruit CRM optionnel | Science, questionnaire contexte |

### Convention Phase 1 (YAGNI)

- Tâche open **sans `project_id`** = « Ce qui traîne ».
- Ne pas ajouter de colonne `clarified` tant que cette convention suffit.
- Assignation à un projet (ou clarifier plus tard) sort la tâche de cette section.

## Fichiers pivots

| Rôle | Fichiers |
|------|----------|
| Tâches | `backend/services/work_tasks.py`, `admin/components/director/WorkTaskList.tsx`, `TodayTasks.tsx`, `taskSort.ts` |
| Jalons / projets | `business_db.py`, `director_platform.py` (`build_project_milestones`), `ProjectToday.tsx`, `gestion/projets/[id]` |
| Briefing | `BriefingBoard.tsx`, `BriefingScreen.tsx`, `briefingBoard.ts` |
| Agenda | `business_db.py` (events), `work_tasks._sync_calendar`, `gestion/planning/*` |
| Direction soft | `knowledge_documents.py`, `context_guide.py`, `gestion/science`, `administration/contexte` |
| HITL (hors coaching) | `core_admin.py` inbox, `inbox/page.tsx` |

## Phases

### Phase 0 — Socle produit (doc + filtres conceptuels)

**Livrable :** ce plan + glossaire ; zéro schéma si possible.

- [x] Figer le glossaire UI (4 titres + tooltips méthode).
- [x] Documenter le tableau Inclure/Exclure pour les agents.
- [x] Lister les blocs `/briefing` à recliquer (jalons → Où je vais ; orphelines → Ce qui traîne ; board HITL → Décisions ; `day_anticipation` → Quand).
- [x] Destinataire V1 : **dirigeant workspace** (recommandé) ; filtre `contact_id` coach↔client plus tard.

**Test :** relecture produit ; pas de code métier hors doc.

### Phase 1 — Ce qui traîne ≠ Décisions

**Livrable :** capture identifiable sans confondre avec `/inbox`.

- [x] Backend : filtre liste « sans projet » (`unassigned=1`) dans `work_tasks.py` + query API.
- [x] Tests : liste filtrée « sans projet ».
- [x] `/briefing` (`TodayTasks`) : section **Ce qui traîne** ; `TaskComposer` y crée.
- [x] `/gestion/taches` : section + filtre « Ce qui traîne seulement ».
- [x] Libellé inbox : garder **Décisions** / **À valider** ; jamais « inbox GTD ».

**Fichiers :** `work_tasks.py`, `core_business.py`, `business.ts`, `TodayTasks.tsx`, `gestion/taches/page.tsx`, `BriefingBoard.tsx` (libellés Décisions).

### Phase 2 — Quoi d’abord (urgence + importance)

**Livrable :** tri à 2 axes, sans jargon.

- [x] Garder `urgent` ; ajouter `important` (bool explicite, défaut false — pas seulement un proxy).
- [x] Matrice 4 cases en langage courant + tooltip « matrice d’Eisenhower ».
- [x] Étendre `taskSort.ts` ; `TaskActionMenu` : Important à côté d’Urgent.
- [x] Vue **Quoi d’abord** : uniquement tâches clarifiées (exclut Phase 1) — filtre `triage=1` + UI briefing / gestion.
- [x] Ne pas fusionner severity HITL dans cette matrice.

**Fichiers :** `work_tasks.py`, `taskSort.ts`, `WorkTaskList.tsx`, `TaskActionMenu.tsx`, `TriageTasks.tsx`, `TodayTasks` / `gestion/taches`, `BriefingBoard`.

### Phase 3 — Où je vais (cible lisible)

**Livrable :** direction visible et liée aux tâches, sans modèle SMART complet au départ.

- [x] V3a : Projet + jalons ouverts + docs science liés = « Où je vais » (filtre UI).
- [ ] V3b (si besoin) : table `goals` légère + `task.goal_id`.
- [x] Bloc briefing **Où je vais** ; scinder `ProjectToday` jalons vs tâches.
- [x] Fiche projet : **Où je vais** (étapes) vs **Travail** (tâches).

**Fichiers :** `director_platform.py`, `ProjectToday.tsx`, `BriefingBoard.tsx`, `gestion/projets/[id]/page.tsx`.

### Phase 4 — Quand je le fais (placement + propositions)

**Livrable :** agenda coaching + propositions HITL de blocs.

- [x] Filtre planning : events `tache` / focus vs séances / CRM.
- [x] Briefing **Quand je le fais** = anticipation filtrée + `due_at` du jour.
- [x] Documenter le créneau auto 09:00–09:30 (`_sync_calendar`) : pas encore du time blocking volontaire.
- [x] Service de propositions → carte HITL / briefing ; acceptation écrit `due_at` + event ; pas d’écriture sans validation.

**Fichiers :** `work_tasks.py`, `business_db.py`, `director_platform.py`, `BriefingBoard.tsx`, `gestion/planning/*`.

### Phase 5 — Unification visible (couche qui relie)

**Livrable :** parcours guidé, pas quatre menus.

- [x] `/briefing` : ordre **Où je vais → Ce qui traîne → Quoi d’abord → Quand je le fais** + **Décisions** à part.
- [x] Raccourcis `/gestion` : mêmes libellés.
- [x] Aide courte (« En savoir plus ») : une phrase + nom de méthode entre parenthèses.
- [ ] Option pack `accompagnement` : seed mémoire / playbook (données).

## Ordre et dépendances

```
P0 glossaire/filtres
 → P1 Ce qui traîne (sépare HITL)
   → P2 Quoi d’abord (besoin d’items clarifiés)
     → P3 Où je vais (donne l’importance / le sens)
       → P4 Quand + propositions (consomme P2+P3)
         → P5 orchestration UI briefing
```

P1 et P3a (filtre UI jalons/science) peuvent avancer **en parallèle** après P0.  
P4 propositions **après** P2 (+ P3 si importance = lien projet/objectif).

## Hors scope

- Quatre pages métier « Mode SMART / GTD… »
- Auto-planif silencieuse Google Calendar
- Remplacer `/inbox` HITL
- OKR / scoring complexe
- Refonte complète du briefing ops (budget LLM, config) — seulement **recliquer** les blocs coaching

## Critères de succès

1. Un utilisateur sans jargon comprend les 4 titres.
2. Une note capturée n’apparaît pas dans Décisions HITL.
3. « Quoi d’abord » ne montre pas la capture brute.
4. Une proposition de bloc cite une cible (projet/objectif) et attend validation.
5. Science / Contexte nourrissent **Où je vais**, pas le tri du jour.
