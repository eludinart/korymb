# Hermes — intelligence et fiabilité (P0 + P1)

Guide pour rendre Hermes **fiable** et **actionnable** sur l'ops Élude In Art.

## Déploiement (VPS)

```powershell
.\scripts\hermes-intelligence-deploy.ps1
.\scripts\hermes-cron-install.ps1
```

Déploie :

| Élément | Chemin VPS |
|---------|------------|
| SOUL | `/docker/hermes-agent-aoxw/data/SOUL.md` |
| Mémoires | `data/memories/ecosystem-eludein.md`, `decisions-eric.md` |
| Skills (15) | `data/skills/*/SKILL.md` |
| Scripts | `data/scripts/` + `/opt/data/scripts/` (hôte) |
| Crons | crontab root (briefing, alertes, smoke, logs) |

## Secret API Korymb (requis pour pont API)

Ajouter sur le VPS dans `/docker/hermes-agent-aoxw/data/.env` :

```
KORYMB_AGENT_SECRET=<même valeur que AGENT_API_SECRET backend Korymb>
KORYMB_API_URL=https://api-korymb.eludein.art
```

Test :

```bash
/opt/data/scripts/korymb-api.sh GET /health
```

## Skills — priorité d'activation

**Toujours** : `eludein-ops-rules`, `eludein-ecosystem`

**P0 — quotidien** :

| Skill | Usage |
|-------|-------|
| `eludein-daily-briefing` | Format briefing strict |
| `korymb-api-bridge` | Briefing/inbox via API |
| `coolify-services-map` | Ne plus confondre les conteneurs |

**P1 — métier** :

| Skill | Usage |
|-------|-------|
| `korymb-inbox-triage` | HITL et inbox |
| `fleur-growth-snapshot` | Croissance app Fleur |
| `eludein-content-radar` | Idées éditoriales |
| `eludein-backup-checklist` | Vérif backups |
| `eludein-log-watcher` | Logs agent |

**Existant** : `korymb-analytics`, `fleur-analytics`, `hermes-vps-health`, `hermes-db-analysis`, `hermes-deploy-check`

## Crons installés (UTC)

| Horaire Paris (été) | Script | Rôle |
|---------------------|--------|------|
| 7h | `eludein-morning-briefing.sh` | Briefing + Telegram |
| 19h | `eludein-evening-recap.sh` | Recap + Telegram |
| /3h | `eludein-alerts.sh` | Alertes proactives |
| /4h | `eludein-post-deploy-smoke.sh` | Smoke (Telegram si fail) |
| /1h | `eludein-log-watch.sh` | Surveillance logs |

Logs : `/var/log/eludein-*.log`

## Profils WebUI (https://hermeswebui.eludein.art)

Créer 3 profils avec skills préchargées :

### Ops VPS

- `eludein-ops-rules`
- `hermes-vps-health`
- `coolify-services-map`
- `eludein-log-watcher`
- `hermes-deploy-check`

### Analytics

- `eludein-ops-rules`
- `hermes-db-analysis`
- `korymb-analytics`
- `fleur-analytics`
- `fleur-growth-snapshot`

### Briefing dirigeant

- `eludein-ops-rules`
- `eludein-daily-briefing`
- `korymb-api-bridge`
- `korymb-inbox-triage`
- `eludein-content-radar`

Prompt startup suggéré (Briefing dirigeant) :

> Tu es le chief of staff ops d'Éric. Vérifie toujours avec eludein-db-check avant de conclure. Format briefing strict. Actions Korymb via korymb-api.sh uniquement.

## Scripts

| Script | Rôle |
|--------|------|
| `korymb-api.sh` | Pont API Korymb |
| `eludein-telegram-send.sh` | Envoi Telegram |
| `eludein-morning-briefing.sh` | Briefing matin |
| `eludein-evening-recap.sh` | Recap soir |
| `eludein-alerts.sh` | Alertes proactives |
| `eludein-post-deploy-smoke.sh` | Smoke périodique |
| `eludein-log-watch.sh` | Logs agent |

## Répartition des rôles

| Besoin | Outil |
|--------|-------|
| Code, PR | Cursor |
| Missions métier | Korymb |
| Ops, SQL, alertes, briefing | Hermes |

---

*Voir aussi : [ADMINISTRATION.md](ADMINISTRATION.md), [KORYMB-DESCRIPTION-HERMES.md](KORYMB-DESCRIPTION-HERMES.md)*
