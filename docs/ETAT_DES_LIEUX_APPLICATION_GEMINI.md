# Etat des lieux complet - tarot.app (brief IA pour Gemini)

## 1) Objectif du document

Ce document sert de base de travail pour une IA (Gemini) afin de:
- comprendre rapidement l'etat actuel de l'application,
- identifier les risques techniques et produit,
- proposer des evolutions concretes et priorisees,
- aider a preparer une roadmap d'amelioration.

## 2) Resume executif

- Le projet est structure autour de deux briques principales: `admin/` (frontend Next.js unifie) et `backend/` (API FastAPI d'orchestration IA).
- La migration front semble quasi finalisee vers Next.js, avec des traces legacy Vite encore presentes au repo racine.
- Le backend est riche fonctionnellement (missions, chat, jobs, memoire, agents custom), mais fortement centralise dans `backend/main.py`.
- La configuration runtime provider/modele est un sujet critique et a deja ete formalisee via ADR.
- La CI couvre build frontend + compile Python, mais pas encore de vraie suite de tests unitaires/contrats/e2e.
- Le repo est actuellement dans un etat de transition avec beaucoup de changements en cours (et artefacts de build presents dans le workspace).

## 3) Portee fonctionnelle actuelle

### Frontend unifie (Next.js)

- Application operateur dans `admin/` avec pages metier:
  - dashboard,
  - missions,
  - chat,
  - historique,
  - configuration runtime,
  - administration.
- Point d'entree principal: redirection vers le dashboard via `admin/app/page.tsx`.

### Backend orchestration (FastAPI)

- API de pilotage des missions IA:
  - lancement de mission,
  - suivi des jobs,
  - annulation/suppression/validation,
  - chat dirigeant,
  - gestion sessions de mission,
  - exposition et mise a jour des settings runtime,
  - endpoints sante/diagnostic.
- Persistance:
  - SQLite par defaut (`backend/data/korymb.db`),
  - MariaDB possible via variables d'environnement.

## 4) Architecture technique

### 4.1 Composants

- `admin/`: Next.js 15 + React 19 + TypeScript + Tailwind + React Query.
- `backend/`: FastAPI + Pydantic v2 + client LLM (Anthropic/OpenRouter) + couche database.
- `tools/`: scripts de verification health/smoke.
- `.github/workflows/ci.yml`: pipeline qualite de base.

### 4.2 Flux principal

1. L'utilisateur agit depuis le frontend Next (`admin/`).
2. Le frontend appelle des routes API Next (`admin/app/api/*`) qui servent de proxy.
3. Le proxy transmet vers FastAPI (`backend/main.py`) avec secret interne.
4. Le backend resolu les settings effectifs (base `.env` + overrides runtime).
5. Le backend execute la logique mission/chat, persiste les donnees, et renvoie l'etat au frontend.

### 4.3 Contrat de configuration runtime

Decision formalisee dans `docs/adr/0001-runtime-config-source-of-truth.md`:
- `.env` = defaults,
- runtime settings = overrides explicites,
- execution backend = toujours sur settings effectifs merges,
- UI = doit afficher l'etat reel provider/modele.

## 5) Points d'entree runtime et scripts

### 5.1 Execution locale recommandee

- `.\start-dev-cursor.ps1`
- `.\stop-dev-cursor.ps1`

### 5.2 Fallback manuel

- `python backend/main.py`
- `npm --prefix admin run dev`

### 5.3 Commandes qualite

- `npm run check` -> build frontend + compile backend.
- `npm run verify:api` -> probe health backend.
- `npm run smoke:deploy -- --app-url <url-front> --backend-url <url-api>` -> smoke post-deploiement.

## 6) Endpoints et interfaces critiques

### 6.1 Endpoints backend majeurs (FastAPI)

- Sante:
  - `GET /health`
  - `GET /health/tools`
  - `GET /admin/system-health`
- Runtime/config:
  - `GET /llm`
  - `GET /tokens`
  - `GET /admin/settings`
  - `PUT /admin/settings`
  - `GET /memory`
  - `PUT /memory`
- Missions/jobs:
  - `POST /run`
  - `GET /jobs`
  - `GET /jobs/{job_id}`
  - `POST /jobs/{job_id}/cancel`
  - `DELETE /jobs/{job_id}`
  - variantes de compatibilite sous `/run/*`
- Sessions/chat:
  - `POST /chat`
  - CRUD `mission-sessions` (+ message/validate/remove)
- Agents:
  - `GET /agents`
  - `GET /admin/agents`
  - `PUT /admin/agents/custom/{agent_key}`
  - `DELETE /admin/agents/custom/{agent_key}`
- Temps reel:
  - `GET /events/stream` (SSE)

### 6.2 Routes API Next (proxy)

- `admin/app/api/korymb/[...path]/route.ts` -> proxy generique backend.
- `admin/app/api/korymb-admin/route.ts` -> proxy admin settings.
- `admin/app/api/korymb-events/route.ts` -> tunnel SSE.

## 7) Donnees et persistance

- DB par defaut: SQLite; fallback/option: MariaDB.
- Tables structurantes dans `backend/database.py`:
  - `jobs`,
  - `mission_sessions`,
  - `llm_usage_events`,
  - `custom_agents`,
  - `enterprise_memory`.
- Le backend applique des migrations defensives de colonnes a chaud (ajout de colonnes manquantes).
- Historique mission, cout/tokens, et memoire entreprise sont deja pris en compte dans le schema.

## 8) Etat migration et transition

### Faits observes

- Front principal deja sur Next.js (`admin/`).
- Fichiers historiques Vite supprimes dans l'etat Git de reference (`src/main.jsx`, `src/App.jsx`, `vite.config.js`, etc.).
- Presence de traces legacy a la racine (ex: `index.html`).

### Lecture

- Le cutover vers Next.js est avance, mais un nettoyage final legacy reste probablement necessaire.

## 9) Qualite, tests, CI

### CI actuelle

- Checkout + install Node,
- install dependencies root + `admin/`,
- build frontend unifie,
- install dependances Python backend,
- compile-check backend (`python -m compileall`).

### Limites actuelles

- Pas de tests unitaires backend automatises dans CI.
- Pas de tests de contrat API executes en CI.
- Pas de e2e critiques executes en CI.

### Strategie documentee

`TESTING.md` confirme une base principalement compile/lint + matrice manuelle, avec pistes d'amelioration (unit, contract, e2e smoke).

## 10) Risques techniques prioritaires

### P0 - Risques immediats

- **Securite configuration**: gestion des secrets a surveiller strictement (coherence secret interne/proxy/public).
- **Bruit de repository**: artefacts generes (`.next`, `__pycache__`) visibles dans l'etat Git de reference, risque de pollution PR.
- **Couplage fort backend**: `backend/main.py` concentre beaucoup de responsabilites.

### P1 - Risques court terme

- **Maintenabilite API**: endpoints dupliques (compatibilite `/jobs/*` et `/run/*`) qui augmentent la surface de regression.
- **Dette de migration**: coexistence potentielle d'elements legacy frontend.
- **Coherence paradigme agents**: coexistence d'indices CrewAI et d'une orchestration custom.

### P2 - Risques moyen terme

- **Observabilite partielle**: metriques et traces peuvent etre renforcees pour diagnostiquer plus vite incidents runtime IA.
- **Contrat typage front/back**: pas de generation automatique de types depuis OpenAPI observee dans les sources lues.

## 11) Recommandations d'evolution (priorisees)

### Priorite 0 (1-2 semaines)

1. Durcir hygiene secrets et artefacts:
   - valider `.gitignore`,
   - retirer artefacts build/cache du flux PR,
   - verifier qu'aucun secret operationnel n'est versionne.
2. Ajouter tests API minimaux (contrat) sur:
   - `/admin/settings`,
   - `/llm`,
   - `/run`,
   - `/jobs/{job_id}`.

### Priorite 1 (2-4 semaines)

1. Decouper `backend/main.py` par domaines:
   - routes runtime,
   - routes jobs,
   - routes chat/sessions,
   - services orchestration.
2. Stabiliser contrat de donnees front/back:
   - schema OpenAPI verifie,
   - types frontend derives du backend.
3. Finaliser suppression/isolement du legacy frontend.

### Priorite 2 (4-8 semaines)

1. Renforcer observabilite IA:
   - latence par endpoint,
   - erreurs provider/model,
   - taux annulation/echec mission,
   - correlation `job_id`.
2. Ajouter e2e smoke critiques:
   - config provider/model,
   - lancement mission,
   - suivi progression,
   - validation mission,
   - flux SSE.

## 12) Questions ouvertes a soumettre a Gemini

1. Quel plan de refactor incrementale recommander pour decomposer `backend/main.py` sans casser le flux mission/chat existant ?
2. Quelle architecture de tests minimale garantirait une baisse rapide des regressions runtime provider/model ?
3. Comment rationaliser les endpoints dupliques (`/jobs/*` vs `/run/*`) avec une strategie de deprecation progressive ?
4. Quelle strategie de typage partage front/back recommandes-tu ici (OpenAPI codegen, schemas partages, autre) ?
5. Comment renforcer la securite des secrets et du proxy sans alourdir l'experience dev locale ?
6. Quels KPIs techniques et produit suivre pour prioriser les optimisations des missions IA ?

## 13) Prompt pret a l'emploi pour Gemini

Copier-coller ce prompt en joignant ce document:

```text
Tu es un architecte logiciel senior specialise en IA applicative, FastAPI et Next.js.
Analyse cet etat des lieux de l'application tarot.app.

Attendu:
1) Un diagnostic critique (forces, faiblesses, risques) classe par severite.
2) Une roadmap d'evolution sur 30/60/90 jours.
3) Des propositions concretes de refactor backend (decoupage de main.py) avec ordre d'execution.
4) Un plan de tests complet (unit, contract, e2e) avec priorites.
5) Un plan de securisation des secrets et de la chaine CI/CD.
6) Des quick wins realistes a livrer en moins de 7 jours.

Contraintes:
- Preserver le comportement actuel des endpoints critiques.
- Limiter les regressions en production.
- Prioriser des changements incrementaux et verifiables.

Format de reponse exige:
- Tableau "Risque / Impact / Effort / Priorite"
- Plan d'action detaille semaine par semaine (12 semaines)
- Checklists de validation avant merge pour chaque lot
```

## 14) Sources internes utilisees

- `README.md`
- `ARCHITECTURE.md`
- `admin/README.md`
- `package.json`
- `admin/package.json`
- `backend/main.py` (inspection des endpoints)
- `backend/database.py`
- `backend/config.py`
- `docs/adr/0001-runtime-config-source-of-truth.md`
- `TESTING.md`
- `.github/workflows/ci.yml`

