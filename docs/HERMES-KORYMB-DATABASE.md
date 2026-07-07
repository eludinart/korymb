# Hermes ↔ Korymb — accès base de données

> Hermes lit la base MariaDB de Korymb en **lecture seule** pour des analyses opérationnelles.
> Les **écritures** et **missions** restent du ressort de Korymb (API + UI).

## Architecture

```
┌─────────────────┐     réseau coolify      ┌──────────────────────────┐
│ Hermes Agent    │ ────────────────────────▶│ MariaDB (Coolify)        │
│ /opt/data/      │   hermes_readonly        │ base `default`           │
│ korymb-sql.sh   │   SELECT only            │ jobs, llm_usage_events…  │
└─────────────────┘                          └──────────────────────────┘
         │                                              ▲
         │ SSH / docker exec                            │ mariadb (rw)
         ▼                                              │
┌─────────────────┐                          ┌──────────┴───────────────┐
│ Analyses,       │                          │ Korymb backend (Coolify) │
│ briefings SQL   │                          │ orchestration, HITL      │
└─────────────────┘                          └──────────────────────────┘
```

| Composant | Rôle |
|-----------|------|
| **Korymb backend** | Seul writer métier (missions, mémoire, inbox) |
| **Hermes `hermes_readonly`** | SELECT uniquement sur `default.*` |
| **`korymb-sql.sh`** | Garde-fou : SELECT + LIMIT, pas de DDL/DML |

## Installation (VPS)

Depuis le repo (Windows) :

```powershell
.\scripts\hermes-korymb-db-setup.ps1
```

Le script :

1. crée `hermes_readonly` sur le conteneur MariaDB Korymb ;
2. écrit `KORYMB_DB_*` dans `/docker/hermes-agent-aoxw/data/.env` ;
3. déploie `/opt/data/scripts/korymb-sql.sh` et la skill `korymb-analytics`.

**Ne jamais committer** le mot de passe — il reste sur le VPS uniquement.

## Utilisation dans Hermes

```bash
# Workspace Élude In Art
/opt/data/scripts/korymb-sql.sh "
SELECT status, COUNT(*) n FROM jobs
WHERE workspace_id = 'ws-default-legacy'
GROUP BY status ORDER BY n DESC
"
```

Skill Hermes : `korymb-analytics` (exemples de requêtes dans `ops/hermes-skills/korymb-analytics/SKILL.md`).

## Schéma — tables principales

### Missions & orchestration

| Table | Colonnes clés |
|-------|----------------|
| `jobs` | `id`, `workspace_id`, `status`, `mission`, `agent`, `tokens_in`, `tokens_out`, `created_at`, `updated_at` |
| `mission_sessions` | Cadrage chat avant lancement |
| `mission_traces` | `job_id`, `cost_usd`, `latency_ms`, `graph_node`, `agent` |
| `mission_checkpoints` | Reprise LangGraph |
| `playbooks` | Scénarios prédéfinis |

### Dirigeant & qualité

| Table | Colonnes clés |
|-------|----------------|
| `director_notifications` | `kind`, `title`, `body`, `read_at`, `job_id` |
| `hitl_plan_snapshots` | Plans en attente validation |
| `quality_verdicts` | Scores qualité |
| `learning_suggestions` | Suggestions mémoire |

### LLM & coûts

| Table | Colonnes clés |
|-------|----------------|
| `llm_usage_events` | `tokens_in`, `tokens_out`, `cost_usd`, `provider`, `model`, `created_at` |
| `llm_runtime_settings` | Config provider/modèle (JSON) |

### Mémoire & chat

| Table | Colonnes clés |
|-------|----------------|
| `enterprise_memory` | Clés JSON par workspace |
| `chat_sessions`, `chat_conversations` | Historique chat dirigeant |
| `memory_history` | Snapshots mémoire |

### Business (gestion)

| Table | Colonnes clés |
|-------|----------------|
| `biz_quotes`, `biz_projects`, `biz_contacts` | Devis, projets, contacts |
| `biz_external_invoices` | Factures Tiime |

### Multi-tenant

| Table | Colonnes clés |
|-------|----------------|
| `korymb_workspaces` | `id`, `name`, `slug` |
| `korymb_users`, `korymb_memberships` | Comptes et rôles |

**Workspace production** : `ws-default-legacy` (`slug = default`, nom « Korymb — Élude In Art »).

## Anti-doublons Hermes / Korymb

| Hermes (SQL) | Korymb (API / UI) |
|--------------|-------------------|
| Lire état missions, coûts, inbox | Lancer / valider missions |
| Détecter anomalies, résumer | HITL, clôtures, mémoire |
| Alerter Eric (Telegram) | Notifications in-app |
| Ops VPS, Docker, cron | Orchestration agents |

Hermes **ne doit pas** : poster sur les réseaux, modifier `enterprise_memory`, créer des `jobs`, ou dupliquer une mission déjà active.

## Référence infra

| Paramètre | Valeur |
|-----------|--------|
| Conteneur MariaDB Korymb | `juehpsnqkm60d2o6dhs38c5t` |
| Base | `default` |
| Tunnel dev Windows | `127.0.0.1:3307` → VPS `127.0.0.1:3306` (socat → autre instance) |
| Hermes données | `/docker/hermes-agent-aoxw/data/` |

## Dépannage

| Symptôme | Action |
|----------|--------|
| `KORYMB_DB_PASSWORD manquant` | Relancer `.\scripts\hermes-korymb-db-setup.ps1` |
| Access denied | Vérifier user `hermes_readonly` : `SHOW GRANTS` |
| Connexion refusée depuis Hermes | Hermes doit être sur le réseau `coolify` ; host = hostname conteneur MariaDB |
| Table vide | Vérifier `workspace_id = 'ws-default-legacy'` |

---

*Voir aussi : [KORYMB-DESCRIPTION-HERMES.md](KORYMB-DESCRIPTION-HERMES.md), [ADMINISTRATION.md](ADMINISTRATION.md)*
