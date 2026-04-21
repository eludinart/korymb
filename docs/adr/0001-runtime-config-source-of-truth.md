# ADR 0001 - Runtime Config Source Of Truth

- Status: Accepted
- Date: 2026-04-20

## Context

Provider/model behavior must stay consistent across frontend, admin, and backend execution. Bugs appeared when runtime selection was hidden by default `.env` fallbacks.

## Decision

Use a clear merge contract:

- `.env` provides defaults,
- runtime settings provide explicit overrides,
- backend execution always uses merged effective settings,
- UI exposes effective provider/model to avoid ambiguity.

## Consequences

- Faster debugging of config-related incidents.
- Lower risk of silent model/provider mismatch.
- Slight increase in implementation discipline when adding new provider fields.
