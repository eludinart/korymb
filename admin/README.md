# Unified Frontend (Next.js)

This Next.js app is the unified frontend for the platform:

- dashboard metier,
- missions, chat, historique,
- configuration runtime LLM/memoire,
- administration systeme.

## Run

```bash
npm install
npm run dev
```

## Quality

```bash
npm run lint
```

## Integration Notes

- Calls are proxied through `app/api/korymb-admin/route.ts`.
- Public runtime calls use `NEXT_PUBLIC_KORYMB_API_URL` and `NEXT_PUBLIC_KORYMB_AGENT_SECRET`.
- Proxy route uses `KORYMB_API_URL` and `KORYMB_AGENT_SECRET`.
- Runtime settings should reflect active backend behavior and never hide effective provider/model state.
