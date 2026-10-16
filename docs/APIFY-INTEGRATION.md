# Intégration Apify

## Ce que ça fait

Apify fait tourner dans le cloud des robots tout prêts (« Actors ») : collecte de fiches Google Maps, pages web, réseaux sociaux, etc.
Korymb peut maintenant :

- lancer un robot à la demande avec une entrée JSON ;
- suivre son statut (READY, RUNNING, SUCCEEDED, FAILED, ABORTED, TIMED-OUT) ;
- récupérer les résultats (dataset) une fois le robot terminé ;
- lister les lancements récents du compte.

L'intégration est **sans état** : rien n'est écrit dans la base ni dans le CRM. Tout est relu depuis Apify.

Fichiers :

- `backend/services/apify_client.py` : client API REST v2 (httpx, délais, erreurs).
- `backend/routers/core_apify.py` : routes admin (protégées par `require_admin`).
- `admin/app/administration/apify/page.tsx` : page « Robots Apify » (menu Administration > Pilotage, propriétaire d'instance).
- `backend/tests/test_apify.py` : tests (httpx simulé).

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `APIFY_API_TOKEN` | Clé d'API Apify. **Obligatoire.** Sans elle, les routes répondent 503. |
| `APIFY_DEFAULT_ACTOR` | Robot utilisé si `actor_id` est vide (optionnel, ex. `compass/crawler-google-places`). |
| `APIFY_ENABLED` | `0` pour couper l'intégration sans retirer la clé (défaut `1`). |

La clé n'est jamais écrite dans le dépôt. `backend/.env.example` ne contient que des valeurs vides.

## Créer la clé dans la console Apify

1. Se connecter sur https://console.apify.com.
2. Menu **Settings > API & Integrations** (ou « Integrations »).
3. Dans **Personal API tokens**, cliquer sur **Create new token**, lui donner un nom (ex. `korymb-prod`).
4. Copier la clé (`apify_api_...`). Ne la coller nulle part ailleurs que dans Coolify.

## Enregistrer la clé dans Coolify

1. Ouvrir Coolify > projet Korymb > application **backend** (API, `api-korymb.eludein.art`).
2. Onglet **Environment Variables**.
3. Ajouter `APIFY_API_TOKEN` = la clé. Cocher **Is Secret** (ou « Is Literal/Locked » selon la version) et laisser la variable disponible au **runtime** (pas besoin au build).
4. Optionnel : `APIFY_DEFAULT_ACTOR`, `APIFY_ENABLED=1`.
5. Enregistrer puis **Redeploy** l'application.
6. Vérifier : `GET /admin/apify/status` doit renvoyer `"configured": true`.

## Routes

Toutes exigent l'authentification admin habituelle (en-tête `X-Agent-Secret` ou session admin).

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/admin/apify/status` | Activée ? Clé présente ? Robot par défaut. |
| POST | `/admin/apify/runs` | Corps `{"actor_id": "...", "input": {...}}`. Lance un robot. |
| GET | `/admin/apify/runs?limit=20` | Lancements récents. |
| GET | `/admin/apify/runs/{run_id}` | Statut d'un lancement. |
| GET | `/admin/apify/runs/{run_id}/results?limit=100` | Résultats si `SUCCEEDED` (`ready: false` sinon). |

## Exemples

Fiches Google Maps des écolieux du Var :

```bash
curl -X POST https://api-korymb.eludein.art/admin/apify/runs \
  -H "X-Agent-Secret: $KORYMB_AGENT_SECRET" -H "Content-Type: application/json" \
  -d '{"actor_id": "compass/crawler-google-places",
       "input": {"searchStringsArray": ["écolieu"], "locationQuery": "Var, France", "maxCrawledPlacesPerSearch": 20}}'
```

Puis suivre `GET /admin/apify/runs/<id>` et lire `GET /admin/apify/runs/<id>/results`.

Depuis l'interface : Administration > **Robots Apify**, saisir le robot et l'entrée JSON, cliquer « Lancer le robot ». Le statut se rafraîchit seul ; les résultats s'affichent en tableau ou en JSON.

## Coûts

La plupart des robots consomment des crédits Apify (temps de calcul, proxys, parfois prix par résultat).
Le plan gratuit offre un petit quota mensuel, ensuite c'est payant. Toujours limiter le volume dans l'entrée
(`maxItems`, `maxCrawledPlacesPerSearch`…) et surveiller le coût affiché (`usage_usd`) et la console Apify.
Pensez à fixer une limite de dépense dans la console (Billing > Limits).

## Suite

- Import des résultats comme contacts **à valider** dans le CRM (pas d'écriture automatique).
- Lancements planifiés (scheduler Korymb ou Schedules Apify) et webhook Apify de fin de run.
- Bibliothèque de robots préconfigurés (écolieux, praticiens, éditeurs).
