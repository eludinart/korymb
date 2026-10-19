# Mémoire des conversations (RAG Korymb)

## Ce que ça fait

Les échanges entre Eric et Layl (chat, appels, messages) sont résumés en **fiches** courtes
et datées, puis envoyés à Korymb. Korymb les range dans sa mémoire vectorielle MariaDB
(table `mission_traces`, colonne `embedding VECTOR(768)`), à côté du journal de mission.
Le chat de Korymb les retrouve automatiquement : `trace_memory_block` injecte les extraits
les plus proches dans le bloc « Souvenirs du journal » avant de répondre.

- Chaque fiche devient une ou plusieurs lignes `kind='conversation'`, `agent='classique'`,
  rattachées au job virtuel `memory:conversations`.
- Le `span_id` est dérivé de `external_id` : réimporter la même fiche ne crée pas de doublon
  (identique → ignorée, modifiée → remplacée).
- Le texte est découpé en morceaux de 700 caractères maximum (limite d'extrait : 800).
- Les secrets évidents (`github_pat_…`, `ghp_…`, `sk-…`, `Bearer …`, `XXX_SECRET=…`, clés privées,
  JWT) sont masqués côté serveur avant écriture, par sécurité. L'expéditeur doit quand même
  les retirer avant envoi.
- Si l'API d'embeddings échoue, l'erreur est journalisée et la fiche est enregistrée sans
  vecteur : rien ne casse (chat, journal, import).

## Routes (clé Classique, `Authorization: Bearer <CLASSIQUE_API_KEY>`)

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/classique/memory` | importer 1 à 100 fiches (512 Ko max par lot, 16 Ko par fiche) |
| GET | `/classique/memory/search?q=…&limit=5` | extraits les plus proches (test). `all_kinds=true` pour chercher aussi dans le journal |
| POST | `/classique/memory/reembed` | recalculer les vecteurs avec l'encodeur courant |

### Format d'une fiche

```json
{
  "fiches": [
    {
      "external_id": "layl-2026-10-17-memoire-rag",
      "title": "Mémoire RAG de Korymb",
      "date": "2026-10-17",
      "project": "Korymb",
      "summary": "Eric veut que les échanges avec Layl nourrissent Korymb.",
      "decisions": ["Fiches courtes et datées plutôt que conversations brutes"],
      "actions": ["Activer OpenRouter dans Coolify", "Lancer le re-calcul des vecteurs"],
      "source": "appel vocal du 17/10",
      "tags": ["rag", "memoire"]
    }
  ]
}
```

Réponse : `{"ok": true, "created": 1, "updated": 0, "skipped": 0, "chunks": 1, "embedded": 1, "results": [...]}`.

## Encodeurs (`KORYMB_EMBED_PROVIDER`)

| Valeur | Effet |
|---|---|
| *(vide)* | désactivé : aucun vecteur, la recherche renvoie une liste vide |
| `hash` | empreinte de mots locale, provisoire, **ne comprend pas le sens** |
| `openrouter` | `POST https://openrouter.ai/api/v1/embeddings` (format OpenAI) |
| `openai` | toute API compatible OpenAI, via `KORYMB_EMBED_BASE_URL` (ex. Ollama, OpenAI) |

Le modèle par défaut est `openai/text-embedding-3-small`, appelé avec `dimensions = KORYMB_VECTOR_DIM`
(768) pour correspondre à la colonne. Si un modèle renvoie plus de dimensions, le vecteur est tronqué
puis normalisé (valable pour les modèles « Matryoshka » comme text-embedding-3). Pour un modèle qui
refuse le paramètre `dimensions`, mettre `KORYMB_EMBED_SEND_DIMENSIONS=0`.

## Activation dans Coolify

1. Projet Korymb → application **backend (API)** → onglet **Environment Variables**.
2. Ajouter :
   - `KORYMB_EMBED_PROVIDER=openrouter`
   - `KORYMB_EMBED_API_KEY=<clé OpenRouter>` (cocher *secret*). Facultatif : à défaut,
     `OPENROUTER_API_KEY` déjà présente est réutilisée.
   - `KORYMB_EMBED_MODEL=openai/text-embedding-3-small` (facultatif, c'est la valeur par défaut)
   - `KORYMB_VECTOR_DIM=768` (ne pas changer si la colonne existe déjà)
   - `CLASSIQUE_API_KEY_SHA256=<sha256 de la clé Classique>` (normalement déjà en place)
3. **Redéployer** le backend.
4. Recalculer les anciens vecteurs (les vecteurs `hash` ne sont pas comparables avec ceux du modèle) :
   ```bash
   curl -X POST https://api-korymb.eludein.art/classique/memory/reembed \
     -H "Authorization: Bearer $CLASSIQUE_API_KEY" -H "Content-Type: application/json" -d '{}'
   ```
   ou, depuis le terminal Coolify du conteneur backend : `python scripts/reembed_traces.py`.
5. Tester :
   ```bash
   curl -G https://api-korymb.eludein.art/classique/memory/search \
     -H "Authorization: Bearer $CLASSIQUE_API_KEY" --data-urlencode "q=mémoire RAG"
   ```

> Changer de modèle ou de dimension plus tard impose de relancer l'étape 4. Changer
> `KORYMB_VECTOR_DIM` après création de la colonne demande en plus une migration de la colonne.

## Version de MariaDB

Le type `VECTOR` et `VEC_DISTANCE_EUCLIDEAN` exigent **MariaDB 11.7 ou plus** (11.8 LTS conseillée).
Sur une version plus ancienne, l'ajout de la colonne échoue silencieusement (journalisé dans
`database.py`) : les fiches sont importées mais sans vecteur et la recherche reste vide. Vérifier avec
`SELECT VERSION();` dans la base Coolify. SQLite (dev local) n'a jamais la colonne.

## Coûts

`text-embedding-3-small` coûte environ 0,02 $ par million de tokens. Une fiche fait quelques centaines
de tokens : 1 000 fiches ≈ 0,01 $. Chaque message du chat déclenche aussi un embedding de la question
(négligeable). Le re-calcul complet de 5 000 traces coûte de l'ordre du centime.
