---
name: eludein-daily-briefing
category: productivity
description: Briefing dirigeant format strict — Korymb + Fleur + VPS. Utiliser pour cron matin/soir et demandes « état du QG ». Zéro improvisation.
---

# Briefing quotidien Élude In Art

Activer **`eludein-ops-rules`** + lire `memories/decisions-eric.md`.

## Format de réponse (obligatoire)

```
📊 Briefing Élude In Art — {date UTC}

1. VPS / Hermes
   - compose ps + hermes HTTPS + WebUI health

2. Korymb (ws-default-legacy)
   - jobs par status (ou API /admin/briefing)
   - notifs non lues
   - coût LLM 24h

3. Fleur d'ÅmÔurs
   - users total, nouveaux 7j

4. Alertes
   - eludein-alerts.sh ou liste manuelle

5. Action unique recommandée
```

Pas de prose longue. **Sorties commandes** en preuve.

## Scripts cron (automatiques)

| Script | Horaire (Paris) | Rôle |
|--------|-----------------|------|
| `eludein-morning-briefing.sh` | 7h | Briefing + Telegram |
| `eludein-evening-recap.sh` | 19h | Recap + Telegram |
| `eludein-alerts.sh` | /3h | Alertes si problème |

## Commandes manuelles

```bash
/opt/data/scripts/eludein-morning-briefing.sh --no-telegram
/opt/data/scripts/eludein-evening-recap.sh
/opt/data/scripts/eludein-alerts.sh --force-report
```

## API Korymb (si `KORYMB_AGENT_SECRET` configuré)

```bash
/opt/data/scripts/korymb-api.sh GET '/admin/briefing?period=today'
```

Préférer l'API pour le briefing Korymb ; SQL en fallback.

## Liens

- Inbox : https://korymb.eludein.art/inbox
- Briefing Korymb : https://korymb.eludein.art/briefing
