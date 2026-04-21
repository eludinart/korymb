# Testing Strategy

## Goals

- Catch regressions early.
- Keep feedback fast for developers.
- Protect the runtime provider/model path end-to-end.

## Required Local Checks

Run before pushing:

```bash
npm run check
```

This runs:

- unified Next build (compile safety + route validation),
- backend python compile check.

## Manual Test Matrix (Minimum)

For any LLM/runtime-related change, validate:

1. change provider + model in configuration UI,
2. save and verify active provider/model indicator,
3. run a mission and confirm expected provider/model behavior,
4. verify error handling for missing API keys.

For UI changes:

- loading state visible,
- success confirmation visible,
- error state actionable,
- no ambiguous button labels.

## CI Gates

CI must pass on pull requests:

- unified frontend lint,
- backend dependency install + compile check.

## Future Improvements

- Add backend unit tests around runtime settings merge logic.
- Add API contract tests for `/admin/settings` and `/llm`.
- Add E2E smoke tests for config save + mission launch flow.
