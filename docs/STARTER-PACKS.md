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
- Administration → **Science de l'entreprise** (`/administration/contexte`) — le parcours de prise de connaissance. L'ancienne adresse `/administration/modeles` y renvoie.

## Implémentation

- Catalogue + apply : `backend/services/starter_packs.py`
- Colonne `korymb_workspaces.starter_pack_id`
- Branched dans `create_workspace(..., starter_pack_id=)` après `seed_workspace_defaults`

## Spécialisation progressive (sans pack)

Après création, l’utilisateur peut :

1. Répondre au **guide de contexte** (`/administration/contexte` et Démarrage) : première question neutre, puis des questions tirées de ce qui est déjà écrit. Tant que le contexte est vide, seuls des standards de gestion apparaissent, masquables. Ensuite, des précisions (chiffres, personnes, offre) n’apparaissent que si le texte ou une demande les justifie. Rien n’est enregistré sans confirmation.
2. Enrichir la **mémoire partagée** à la main (`/administration/memory`)
3. Créer / renommer des **agents** et **équipes** (templates d’équipes via l’assistant)
4. Sauver des **playbooks** et **templates de mission** (UI ou outils `korymb_save_*`)
5. Configurer la **vitrine** (`/administration/vitrine`)

Le pack n’est qu’un accélérateur ; le moteur reste le même pour tous les espaces.
