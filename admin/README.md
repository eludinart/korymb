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

- API métier : proxy `app/api/korymb/[...path]/route.ts` (cookie de session, pas de secret agent).
- Réglages LLM admin : `app/api/korymb-admin/route.ts` (session admin).
- URL API côté serveur Next : `KORYMB_API_URL` (repli dev `NEXT_PUBLIC_KORYMB_API_URL`).
- Le navigateur n'envoie pas le secret agent. Hermes et les scripts l'envoient directement à l'API (`X-Agent-Secret`).
- Runtime settings should reflect active backend behavior and never hide effective provider/model state.
