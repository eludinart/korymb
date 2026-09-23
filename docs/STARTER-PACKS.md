# Starter packs Korymb

Korymb est un **outil générique** d’orchestration d’activité. Il n’y a pas de vertical métier dans le moteur.

La spécialisation d’un espace se fait par ses **données** (mémoire, agents, playbooks, vitrine) et, en option, par un **starter pack** : contenu copié une fois à la création (ou appliqué plus tard), entièrement modifiable ensuite.

## Catalogue V1

| Id | Label | Contenu |
|----|-------|---------|
| `blank` | Commencer vide | Seed générique uniquement (`_STARTER_PLAYBOOKS`) |
| `accompagnement` | Accompagnement | Notes de séance, accord/devis, atelier, courrier de liaison + mémoire initiale |
| `contenu` | Création de contenu | Article, pack réseaux, PDF + mémoire charte éditoriale |

## API

- `GET /auth/starter-packs` — catalogue (résumé)
- `POST /auth/register` — body optionnel `starter_pack_id` (défaut `blank`)
- `POST /auth/workspaces` — idem
- `POST /auth/workspaces/apply-starter-pack` — admin, workspace courant ; idempotent
- `GET /auth/me` → `workspace.starter_pack_id` (metadata d’audit)

## UI

- Inscription `/register` et `/espace` : sélecteur de modèle
- Briefing `?welcome=1&pack=…` : rappel post-inscription
- Administration → **Modèles de démarrage** (`/administration/modeles`)

## Implémentation

- Catalogue + apply : `backend/services/starter_packs.py`
- Colonne `korymb_workspaces.starter_pack_id`
- Branched dans `create_workspace(..., starter_pack_id=)` après `seed_workspace_defaults`

## Spécialisation progressive (sans pack)

Après création, l’utilisateur peut :

1. Enrichir la **mémoire partagée** (`/administration/memory`)
2. Créer / renommer des **agents** et **équipes** (templates d’équipes via l’assistant)
3. Sauver des **playbooks** et **templates de mission** (UI ou outils `korymb_save_*`)
4. Configurer la **vitrine** (`/administration/vitrine`)

Le pack n’est qu’un accélérateur ; le moteur reste le même pour tous les espaces.
