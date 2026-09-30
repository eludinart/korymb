---
name: hermes-vps
description: Infrastructure Élude — VPS Coolify (187.124.42.135), Hermes Agent (Nous Research) en session ops, MariaDB, WebUI. À utiliser pour hébergement, ops, briefing Hermes, ponts SQL/API, ou pour ne pas confondre Cursor et Hermes.
icon: terminal
color: purple
---

# Hermes + VPS Élude

## Rôles — ne pas confondre

| Acteur | Rôle |
| --- | --- |
| **Cursor** (Desktop / Cloud) | Coder, PR, refacto dans les **repos Git** ; dev local avec tunnels MariaDB |
| **Hermes Agent** (VPS) | Ops & intelligence : briefings, alertes, analyses **lecture seule**, smoke post-deploy, mémoire Élude |
| **Apps Coolify** (Fleur, Korymb, Mandala) | Writers métier — seuls autorisés à écrire dans leurs bases / API |

Hermes **ne remplace pas** Cursor pour le développement applicatif. Cursor **ne remplace pas** Hermes pour la surveillance VPS continue.

## VPS

| Élément | Valeur connue |
| --- | --- |
| Hôte | `187.124.42.135` (SSH root — clé locale, pas dans git) |
| Orchestration | **Coolify** (apps Next + MariaDB + Hermes) |
| Hermes data | `/docker/hermes-agent-aoxw/data/` (SOUL, memories, skills, `.env`) |
| Scripts hôte | `/opt/data/scripts/` (`fleur-sql.sh`, `korymb-sql.sh`, `korymb-api.sh`, …) |
| WebUI Hermes | https://hermeswebui.eludein.art |
| API Korymb | https://api-korymb.eludein.art |

Docs source (repo Korymb) : `docs/HERMES-INTELLIGENCE.md`, `HERMES-FLEUR-DATABASE.md`, `HERMES-KORYMB-DATABASE.md`, `KORYMB-DESCRIPTION-HERMES.md`.

## Hermes — capacités déjà prévues

Skills ops déployées côté Hermes (pas dans ce dépôt Cursor) notamment :

- Toujours : `eludein-ops-rules`, `eludein-ecosystem`
- Quotidien : `eludein-daily-briefing`, `korymb-api-bridge`, `coolify-services-map`
- Métier : `korymb-inbox-triage`, `fleur-growth-snapshot`, `eludein-content-radar`, `eludein-backup-checklist`, `eludein-log-watcher`
- Analytics : `korymb-analytics`, `fleur-analytics`, `hermes-vps-health`, …

Crons typiques : briefing matin / recap soir (Telegram), alertes, smoke post-deploy, watch logs.

## Bases — anti-confusion

| App | Script Hermes | Tables / notes |
| --- | --- | --- |
| Fleur | `fleur-sql.sh` | `wp_fleur_*`, `wp_users` — **SELECT only** |
| Korymb | `korymb-sql.sh` | `jobs`, `korymb_*`, `llm_usage_events` — **SELECT only** |
| Mandala | (à confirmer / étendre) | préfixe `mdl_*` — base Coolify séparée |

Même serveur MariaDB possible, **namespaces et users readonly distincts**. Ne jamais utiliser le mauvais script.

## Sync tronc → Hermes

Depuis ce dépôt (machine d'Éric avec SSH) :

```powershell
.\scripts\sync-tronc.ps1 -ToHermesVps
```

Met à jour skills `eludein-ecosystem`, `eludein-second-cerveau` et mémoires sous `/docker/hermes-agent-aoxw/data/`.

## Instructions agent Cursor

1. Coder → repos Git + skills produit ; boucle → `second-cerveau`.
2. Ops live → Hermes / SSH ; préparer briefs, ne pas inventer de SQL root.
3. Ne jamais committer secrets (`sync-config.env`, Coolify, `KORYMB_AGENT_SECRET`).
4. Après changement de carte : **sync tronc** (repos + Hermes).
5. Charger `ecosysteme-elude` + `second-cerveau` si multi-nœuds.

## À confirmer avec Eric

- Session Hermes active : id / profil WebUI (Ops VPS, etc.)
- Accès Mandala SQL pour Hermes (script dédié ?)
- Politique Telegram / canaux d’alerte
