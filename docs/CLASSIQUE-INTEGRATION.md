# Intégration Classique ↔ Korymb

Classique est l'agent personnel et technique d'Eric (voix, chat, code), hors Korymb.
Cette intégration ajoute : une API partagée, un routage par catégories, un pont
Google Agenda bidirectionnel et une fiche « Agents connectés » dans l'administration.
Hermès n'est pas modifié (ops/hermes, ops/hermes-scripts, cron, Telegram inchangés).

## 1. API partagée

Authentification : `Authorization: Bearer <clé>`. La clé est comparée à son empreinte
SHA-256 (`CLASSIQUE_API_KEY_SHA256`, recommandé) ou à `CLASSIQUE_API_KEY` (hachée au vol).
Sans clé configurée, les routes répondent `503`. Espace : header `X-Workspace-Id`,
champ `workspace`, sinon `CLASSIQUE_WORKSPACE_ID` (défaut `ws-default-legacy`).

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/classique/tasks` | Déposer une tâche → `202` + enveloppe + `poll_url` |
| GET | `/classique/tasks/{id}` | Polling statut / résultat |
| POST | `/classique/tasks/{id}/result` | Classique rend le résultat (tâches `classique` ou `concertation`) |
| POST | `/classique/route` | Prévisualiser le routage, sans écriture |
| GET | `/classique/identity` | (opérateur) fiche Classique + état config |
| GET | `/classique/admin/tasks` | (opérateur) file des tâches |
| POST | `/classique/admin/tasks/{id}` | (opérateur) clôturer côté Korymb / Eric |

### Enveloppe standard

Requête :
```json
{"intent": "Relancer le devis Dupont", "category": "business", "payload": {"contact": "Dupont"},
 "callback_url": "https://classique.example/hook", "external_id": "clq-123", "workspace": "ws-default-legacy"}
```
Réponse (identique en polling et webhook) :
```json
{"id": "clq-…", "external_id": "clq-123", "workspace": "ws-default-legacy",
 "category": "business", "target": "korymb", "routing": {"source": "explicit", "reason": "…", "matched": {}},
 "intent": "…", "payload": {}, "callback_url": "…", "status": "queued",
 "result": null, "error": null, "created_at": "…", "updated_at": "…"}
```

Statuts : `queued` (Korymb), `routed_to_classique`, `concertation`, `awaiting_eric`,
`running`, puis terminaux `completed` | `failed` | `cancelled` (non modifiables).

### Webhook

Quand une tâche atteint un statut terminal et porte un `callback_url`, Korymb fait un
`POST` JSON de l'enveloppe avec :
- `X-Korymb-Timestamp` : epoch secondes
- `X-Korymb-Signature` : `sha256=` + HMAC-SHA256(`CLASSIQUE_WEBHOOK_SECRET`, `"{timestamp}." + corps brut`)
- `X-Korymb-Task-Id`

Sans `CLASSIQUE_WEBHOOK_SECRET`, aucun webhook n'est envoyé (polling seul).
État de livraison : colonne `callback_state` (`delivered` | `failed`).

Table : `classique_tasks` (créée par `init_db()` et par la révision Alembic `003_classique_calendar_sync`).

## 2. Routage par catégories

`backend/services/classique_router.py` (fonction pure `route()`).

| Catégorie | Alias acceptés | Cible |
|---|---|---|
| `business` (a, métier pur) | metier, a | `korymb` |
| `personal_technical` (b) | personal, perso, technical, technique, b | `classique` |
| `mixed` (c) | mixte, c | `concertation` |
| `undetermined` (d) | indetermine, unknown, d | `eric` |

Une catégorie explicite valide gagne. Sinon, mots-clés (accents ignorés) sur intent + payload :
métier seul → business ; perso/technique seul → personal_technical ; les deux → mixed ; aucun → undetermined (Eric).

## 3. Pont Google Agenda

`backend/services/calendar_sync.py`. Désactivé par défaut.

- **Fréquence** : job APScheduler `korymb-gcal-sync` toutes les `KORYMB_GCAL_SYNC_INTERVAL_MIN` minutes (défaut 15, min 5), plus `POST /calendar-sync/run` (bouton dans Administration → Agents connectés).
- **Fenêtre** : de J-`KORYMB_GCAL_SYNC_PAST_DAYS` (7) à J+`KORYMB_GCAL_SYNC_AHEAD_DAYS` (60).
- **Qui fait foi** : Google pour les heures et l'existence ; Korymb pour le contexte métier (contact, projet, type, notes, visibilité).

Un passage :
1. **Pull Google → Korymb**
   - événement Google inconnu → créé dans `biz_calendar_events` (`event_type=google`, à compléter côté métier) ;
   - événement lié dont l'heure Google diffère → Korymb prend l'heure Google ;
   - événement annulé dans Google → `status=cancelled` dans Korymb ;
   - notes Korymb modifiées depuis le dernier passage → poussées dans la description Google (pas les heures).
2. **Push Korymb → Google** : créneau Korymb futur sans `google_event_id`
   - chevauche un créneau Google occupé (non « disponible ») → **pas créé**, conflit `slot_already_booked` ;
   - sinon créé dans Google avec `extendedProperties.private.korymb_event_id`.
3. **Conflits** (`calendar_sync_conflicts`, statut `open` → `resolved` | `dismissed`) :
   - `slot_already_booked` : créneau Korymb sur un horaire déjà pris ;
   - `korymb_time_change_not_pushed` : heure modifiée dans Korymb seulement — remise à l'heure Google, signalée ;
   - `time_changed_both_sides` : heure modifiée des deux côtés — Google gagne, signalé.
   Routes : `GET /calendar-sync/status`, `GET /calendar-sync/conflicts`, `POST /calendar-sync/conflicts/{id}/resolve`.

Tables : `calendar_sync_links` (event_id ↔ google_event_id, heures synchronisées), `calendar_sync_conflicts`, `calendar_sync_runs` (journal).

## 4. Identité

Page `/administration/classique` (« Agents connectés », groupe Gestion des agents, propriétaire d'instance) :
Fleur d'Amours, Mandala, Classique, Hermès, file des tâches Classique, état du pont agenda.

## Variables d'environnement (Coolify, service backend)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `CLASSIQUE_API_KEY_SHA256` | oui (ou la suivante) | Empreinte SHA-256 hex de la clé Classique |
| `CLASSIQUE_API_KEY` | alternative | Clé en clair (moins sûr) |
| `CLASSIQUE_WEBHOOK_SECRET` | pour les webhooks | Secret HMAC partagé avec Classique |
| `CLASSIQUE_WORKSPACE_ID` | non | Espace par défaut (`ws-default-legacy`) |
| `KORYMB_GCAL_SYNC_ENABLED` | pour la synchro | `1` pour activer |
| `KORYMB_GCAL_SYNC_INTERVAL_MIN` | non | Défaut 15 |
| `KORYMB_GCAL_SYNC_WORKSPACE_ID` | non | Espace synchronisé (`ws-default-legacy`) |
| `KORYMB_GCAL_SYNC_PAST_DAYS` / `_AHEAD_DAYS` | non | 7 / 60 |
| `GOOGLE_CALENDAR_ID` | non | Défaut `primary` |
| Identifiants Google | pour la synchro | OAuth existant (refresh token + client id/secret, scope `calendar`) ou `GOOGLE_CALENDAR_ACCESS_TOKEN` / `GOOGLE_API_ACCESS_TOKEN` — mêmes réglages que l'intégration Google Workspace |

Générer l'empreinte : `python -c "import hashlib,sys;print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" '<clé>'`.
