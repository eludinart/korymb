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
