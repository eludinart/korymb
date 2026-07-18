---
name: korymb-analytics
category: data-science
description: Analyses opérationnelles sur la base MariaDB Korymb (missions, tokens, inbox, mémoire) en lecture seule. Ne jamais écrire en base — déléguer les actions métier à l'API Korymb.
---

# Korymb Analytics (MariaDB lecture seule)

Hermes interroge **directement** la base Korymb pour des analyses rapides (SQL).
Korymb reste propriétaire des **écritures** et des **missions** ; Hermes **lit** et **synthétise**.

## Comment se connecter (mode d'emploi Hermes)

**Tu n'as pas besoin de saisir un mot de passe ni de configurer une connexion.**
Tout est déjà prêt dans ton environnement (`/opt/data`).

### Méthode à utiliser (obligatoire)

Exécute toujours tes requêtes via le script :

```bash
/opt/data/scripts/korymb-sql.sh "SELECT ... LIMIT N"
```

- Le script lit les identifiants dans `/opt/data/.env` (`KORYMB_DB_*`).
- Il se connecte au conteneur MariaDB Korymb sur le réseau Docker `coolify`.
- Il accepte **SELECT**, **SHOW**, **DESCRIBE** ; `LIMIT` auto (200) sur les SELECT si absent.

### Vérifier que la connexion fonctionne

```bash
/opt/data/scripts/korymb-sql.sh "SELECT COUNT(*) AS workspaces FROM korymb_workspaces LIMIT 1"
```

Résultat attendu : un nombre (ex. `10`). Si erreur `KORYMB_DB_PASSWORD manquant` → signaler à Éric (relancer `hermes-korymb-db-setup.ps1` côté repo).

### Où exécuter la commande

| Contexte | Commande |
|----------|----------|
| Terminal intégré Hermes | `/opt/data/scripts/korymb-sql.sh "SELECT ..."` |
| `execute_code` (bash) | même commande dans un shell |
| SSH vers le VPS | `docker exec hermes-agent-aoxw-hermes-agent-1 /opt/data/scripts/korymb-sql.sh "SELECT ..."` |

### Ce qu'il ne faut **pas** faire

- **Ne jamais** utiliser `docker exec ... mariadb -uroot` — utilise uniquement `korymb-sql.sh`.
- **Ne jamais** cibler le conteneur `p11nw75ijqbg4lfzmwbw2m3m` (MariaDB Mandala vide) : le bon conteneur est `juehpsnqkm60d2o6dhs38c5t`.
- Ne pas modifier `korymb-sql.sh` ni `/opt/data/.env` sans demande explicite d'Éric.
- Ne pas lire ni afficher les mots de passe (`KORYMB_DB_PASSWORD`, root MariaDB) dans le chat.
- Ne pas tenter INSERT/UPDATE/DELETE (refusé par le script **et** par l'utilisateur MariaDB).
- Ne pas se connecter à `127.0.0.1:3307` (tunnel dev Windows d'Éric, pas ton environnement).

### Paramètres de connexion (référence)

Variables dans `/opt/data/.env` (déjà configurées) :

| Variable | Valeur typique |
|----------|----------------|
| `KORYMB_DB_HOST` | `juehpsnqkm60d2o6dhs38c5t` (hostname conteneur MariaDB Coolify) |
| `KORYMB_DB_PORT` | `3306` |
| `KORYMB_DB_NAME` | `default` |
| `KORYMB_DB_USER` | `hermes_readonly` |
| `KORYMB_DB_PASSWORD` | *(secret VPS — jamais afficher)* |
| `KORYMB_DB_CONTAINER` | `juehpsnqkm60d2o6dhs38c5t` |

Workspace production Élude In Art : `ws-default-legacy` (`korymb_workspaces.slug = default`).

## Règles impératives

1. **Lecture seule** — pas d'INSERT/UPDATE/DELETE ; pas de duplication d'actions Korymb (missions, posts, mémoire).
2. **Toujours filtrer** `workspace_id = 'ws-default-legacy'` sauf analyse multi-tenant explicite.
3. **Ne jamais exposer** mots de passe, tokens JWT, clés API, `password_hash`.
4. Préférer des **agrégats** et **TOP N** ; éviter `SELECT *` sur `enterprise_memory` ou `jobs.events_json`.
5. Pour **lancer une mission** ou **valider HITL** → API Korymb (`https://api-korymb.eludein.art`), pas SQL.

## Tables utiles

| Table | Contenu |
|-------|---------|
| `jobs` | Missions/jobs : status, tokens, mission, agent, dates |
| `mission_sessions` | Cadrage avant exécution |
| `mission_traces` | Coûts, latence, nœuds graphe |
| `llm_usage_events` | Usage LLM détaillé |
| `director_notifications` | Notifications dirigeant |
| `enterprise_memory` | Mémoire entreprise (JSON) |
| `biz_quotes`, `biz_projects` | Devis / projets |
| `korymb_workspaces` | Espaces multi-tenant |

## Requêtes types

### Missions actives / récentes

```bash
/opt/data/scripts/korymb-sql.sh "
SELECT id, status, agent, LEFT(mission, 80) AS mission, updated_at
FROM jobs
WHERE workspace_id = 'ws-default-legacy'
  AND status NOT IN ('completed', 'cancelled')
ORDER BY updated_at DESC
LIMIT 20
"
```

### Coût tokens 7 jours

```bash
/opt/data/scripts/korymb-sql.sh "
SELECT DATE(created_at) AS day,
       SUM(tokens_in + tokens_out) AS tokens,
       ROUND(SUM(cost_usd), 4) AS usd
FROM llm_usage_events
WHERE workspace_id = 'ws-default-legacy'
  AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY DATE(created_at)
ORDER BY day DESC
"
```

### Inbox dirigeant (notifications non lues)

```bash
/opt/data/scripts/korymb-sql.sh "
SELECT kind, title, LEFT(body, 120) AS excerpt, created_at
FROM director_notifications
WHERE workspace_id = 'ws-default-legacy' AND read_at IS NULL
ORDER BY created_at DESC
LIMIT 15
"
```

### Synthèse opérationnelle (briefing SQL)

```bash
/opt/data/scripts/korymb-sql.sh "
SELECT
  (SELECT COUNT(*) FROM jobs WHERE workspace_id='ws-default-legacy' AND status NOT LIKE 'completed%') AS jobs_open,
  (SELECT COUNT(*) FROM director_notifications WHERE workspace_id='ws-default-legacy' AND read_at IS NULL) AS notif_unread,
  (SELECT ROUND(SUM(cost_usd),2) FROM llm_usage_events WHERE workspace_id='ws-default-legacy' AND DATE(created_at)=CURDATE()) AS cost_today_usd
"
```

## Livrable attendu

Pour chaque analyse : **3–5 insights actionnables** + **1 recommandation** (sans exécuter à la place de Korymb).
Exemple : « 2 missions bloquées HITL depuis >48h → ouvrir /inbox sur Korymb ».

## Doc complète

Repo Korymb : `docs/HERMES-KORYMB-DATABASE.md`
