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
- Le secret agent (`KORYMB_AGENT_SECRET`) n'est pas transmis par le navigateur. Hermes l'envoie directement à l'API.
- Runtime settings should reflect active backend behavior and never hide effective provider/model state.
