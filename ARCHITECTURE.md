# Architecture Overview

## System Topology

- `admin/` (Next.js): unified operator-facing application (metier, missions, chat, historique, configuration, administration).
- `backend/` (FastAPI): orchestration engine, mission lifecycle, tool integrations, and persistence.

## Core Runtime Flow

1. User action starts from `admin/`.
2. Frontend calls FastAPI endpoints.
3. Backend resolves effective settings through:
   - `backend/.env` defaults,
   - runtime overrides (`backend/data/runtime_settings.json`).
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
- Inbox dirigeant: `GET /admin/inbox` — agrège HITL, clôtures, questions CIO, scheduler, qualité, apprentissage.
- Briefing: `GET /admin/briefing` — décisions du jour, missions actives, budget, analytics 24h.
- Notifications in-app: table `director_notifications`, SSE `director_notification`, `GET/PATCH /admin/notifications`.
- HITL unifié: `services/hitl_unified.resolve_hitl` — `/jobs/{id}/hitl/resolve` et `/missions/jobs/{id}/validate`.
- Playbooks: `GET/POST /playbooks`, `POST /playbooks/{id}/launch` — bibliothèque Fleur/Sivana.
- Estimation coût pré-vol: `POST /missions/estimate-cost`.
- Audit/replay: `GET /jobs/{id}/audit-bundle`, `GET /jobs/{id}/traces`, `POST /jobs/{id}/clone`.
- Garde-fou qualité: `quality_verdicts`, behavior `quality.min_score_to_complete`, `POST /jobs/{id}/quality-override`.
- Notifications externes (phase 5): `notification.email_to`, `notification.webhook_url` via `services/notifications.py`.
- Routes `/run/*` deprecated (header `Deprecation: true`) — préférer `/jobs/*`.
