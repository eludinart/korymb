# Architecture Overview

## System Topology

- `admin/` (Next.js): operator cockpit (`/briefing`, missions, gestion, administration), public storefront (`/p/{slug}`), and participant space (`/a/{slug}`: home, sessions, resources, account).
- `backend/` (FastAPI): orchestration engine, mission lifecycle, tool integrations, and persistence.

## Core Runtime Flow

1. User action starts from `admin/`.
2. Frontend calls FastAPI endpoints.
3. Backend resolves effective settings through:
   - `backend/.env` defaults,
   - runtime overrides persisted in DB (`llm_runtime_settings`, UI `/configuration`).
4. Backend routes the call to the selected LLM provider/model.
5. Usage, cost, and mission state are persisted and returned to UI.

## Configuration Model

- `.env` is the baseline configuration.
- runtime settings are explicit overrides, updated via admin endpoints.
- provider/model must always be treated as dynamic runtime values, not hardcoded defaults in feature logic.

## Reliability Principles

- Validate every API payload at boundaries (Pydantic models).
- Keep error responses explicit and user-safe (`detail` + actionable message).
- Avoid hidden fallbacks that mask provider/model mismatches.
- Keep observability lightweight but consistent (logs, usage records, health endpoints).

## Performance Principles

- Keep orchestration loops bounded (timeouts/retries with clear limits).
- Prefer targeted refreshes over full-page reload behavior.
- Cache static metadata where safe; fetch fresh runtime state only when needed.

## Change Safety

Every feature touching LLM execution must verify:

- selected provider is preserved through the full call path,
- selected model is shown in UI and reflected by backend public info endpoints,
- runtime setting changes are persisted and reloaded consistently.

## Orchestration (LangGraph)

- Missions can run via `orchestration.engine` behavior setting: `legacy` | `langgraph` | `shadow`.
- Checkpoints: `backend/graph/` + SQLite checkpointer (`backend/data/langgraph_checkpoints.db`).
- HITL canonique: `GET /jobs/{id}/hitl`, `POST /jobs/{id}/hitl/resolve`.
- Clôture dirigeant post-mission: `POST /jobs/{id}/validate-mission` (distinct du HITL).
- Décisions (file dirigeant, pas le courrier) : `GET /admin/inbox` — agrège HITL, clôtures, questions CIO, scheduler, qualité, apprentissage. UI : `/inbox` libellé **Décisions**.
- Courrier prospection: `/gestion/courrier` · `GET /business/emails` · `POST /business/emails/sync` — sync Gmail auto (`gmail_prospect_sync`, 15 min).
- Briefing: `GET /admin/briefing` — décisions du jour, missions actives, budget, analytics 24h.
- Notifications in-app: table `director_notifications`, SSE `director_notification`, `GET/PATCH /admin/notifications`.
- HITL unifié: `services/hitl_unified.resolve_hitl` — `/jobs/{id}/hitl/resolve` et `/missions/jobs/{id}/validate`.
- Playbooks: `/gestion/playbooks` · `GET/POST /playbooks`, `POST /playbooks/{id}/launch` — bibliothèque Fleur/Sivana/studio (création, pas Administration).
- Livrables: `/gestion/livrables` — bibliothèque des pièces produites (redirect depuis `/livrables`).
- Studio de contenus: `/gestion/studio` · `GET /studio/catalog` · `POST /studio/generate` · `POST /studio/publish` — briefs multi-formats (article, réseaux, PDF, podcast, vidéo) à partir de la mémoire entreprise ; **moteurs média en chaîne** (gratuit → payant, `MEDIA_ENGINE_MODE` economy|quality) ; publication externe via HITL. Menu Gestion = **Création** (studio, playbooks, livrables) + **Activité** (contacts, courrier, projets, planning, devis).
- Missions UI (`/missions`) : cartes compactes (phase · origine · CTA) ; panneau **Prochaine action** (publier / agenda / envoyer / décider / terminer) branché sur la file Décisions ; modes Quotidien / Dossier.
- Intégrations UI (`/administration/integrations`) : sections Essentielles / Création / Métier / Technique ; cartes fusionnées Google Workspace et Médias créatifs ; champs `advanced` repliés. Catalogue API inchangé (`google_oauth`, `media_ai`, …) + métadonnées `section` / `advanced`. Deep-links `?group=google` / `?group=creative_media` (alias des ids catalogue).
- Estimation coût pré-vol: `POST /missions/estimate-cost`.
- Audit/replay: `GET /jobs/{id}/audit-bundle`, `GET /jobs/{id}/traces`, `POST /jobs/{id}/clone`.
- Garde-fou qualité: `quality_verdicts`, behavior `quality.min_score_to_complete`, `POST /jobs/{id}/quality-override`.
- Notifications externes (phase 5): `notification.email_to`, `notification.webhook_url` via `services/notifications.py`.
- Routes `/run/*` deprecated (header `Deprecation: true`) — préférer `/jobs/*`.
- Vitrine publique : `GET /public/storefront/{slug}` (sans auth) + fichier public `GET /public/storefront/{slug}/events/{id}/file` + identité `GET /public/storefront/{slug}/brand/{logo|cover}`. Réglages : logo, couverture, lieu, contact, accent/papier/typo nommés. Inscription participant : `POST /auth/register-subscriber` (statut `pending` jusqu’à validation). Invitation : `POST /storefront/participants/invite` puis `POST /auth/redeem-invite`. Connexion : `/login` (opérateur) vs `/p/{slug}/connexion` (participant). Espace participant : `GET /subscriber/home` (filtre visibilité + participants actifs). UI : `/a/{slug}`, `/p/{slug}`, `/p/{slug}/inscription`, `/p/{slug}/invitation`, `/p/{slug}/connexion`. Un créneau porte `visibility` (`internal` | `selected` | `participants` | `public`) et `audience_user_ids` (participants choisis, distincts du CRM). `audience_contact_ids` reste un repli. `is_public` reste dérivé des visibilités `participants`/`public`. Téléchargement participant : `GET /subscriber/events/{id}/file`. Profil : `PATCH /auth/profile` (nom, mot de passe).
