# Contributing

## Development Workflow

1. Create a branch from the current integration branch.
2. Implement in small, reviewable commits.
3. Run `npm run check` locally before requesting review.
4. Open a PR with context, screenshots (if UI), and test evidence.

## Definition Of Done

A change is done when:

- behavior is implemented and manually validated,
- lint and backend compile checks pass,
- affected docs are updated (`README`, `ARCHITECTURE`, `TESTING`),
- UX states are handled (loading, success, error, empty),
- no sensitive value is introduced in committed files.

## Pull Request Checklist

- [ ] Scope is focused and reversible.
- [ ] Runtime config behavior remains consistent (`.env` + runtime overrides).
- [ ] API contract changes are reflected in frontend usage.
- [ ] Error messages are actionable for users.
- [ ] `npm run check` completed successfully.

## Commit Style

Use concise imperative messages:

- `fix llm provider runtime selection`
- `improve config action labels in dashboard`
- `add ci checks for frontend and backend`

## Review Priorities

Reviewers should prioritize:

1. behavioral regressions,
2. runtime configuration consistency,
3. failure states and recoverability,
4. user-facing clarity and UX coherence.
