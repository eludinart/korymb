---
name: fleur-card-of-day
category: productivity
description: Carte du jour du Tarot Fleur d'Amôurs pour le post quotidien. Exécuter fleur-card-of-day.sh et rédiger uniquement autour de cette carte. Ne jamais choisir, tirer ou remplacer une carte.
---

# Carte du jour — Fleur d'Amôurs

Le cron « Post quotidien Fleur d'Amôurs » (`fcc2887493f1`) **ne choisit pas** la carte.
Un appel LLM sans donnée qui change retombe toujours sur la même carte.

## Commande obligatoire

```bash
/opt/data/scripts/fleur-card-of-day.sh
```

Test d'une date : `/opt/data/scripts/fleur-card-of-day.sh --date YYYY-MM-DD`

Sortie JSON (défaut) ou texte (`--text`). Champs à recopier tels quels :

| Champ | Usage |
|-------|--------|
| `name` | Nom de la carte dans le post. Ne pas le reformuler. |
| `cycle` | Cycle (`feu`, `eau`, `air`, `terre`, `ether`, `coeur`, `vegetal`, `vie`). |
| `slug` | Ancre du chapitre du manuel. |
| `url` | Seul lien de la carte. |
| `quote` | Question racine du manuel. Ne pas inventer une autre citation. |
| `page` | Pages livre, par exemple `140-141`. |

Le jeu compte 65 cartes. L'ordre est figé dans `fleur-deck.json` (à côté du script). Chaque carte sort une fois avant de revenir. Deux jours de suite ne partagent jamais une carte. La date est celle de `Europe/Paris`.

## Règles du post

1. Exécuter le script **avant** d'écrire.
2. Si le script échoue, ne pas publier : signaler l'erreur.
3. Interdit de tirer, d'échanger ou de « améliorer » la carte.
4. Ton systémique et relationnel. Pas de divination.
5. Ne pas dupliquer ce cron depuis `eludein-content-radar`.

## D'où vient le jeu

Manuel et noms d'app : dépôt `eludinart/fleur-amours` (`next/public/manuel`, `next/src/data/tarotCards.ts`).
Les tables `wp_fleur_*` ne contiennent pas le catalogue. Ne pas interroger MariaDB pour choisir la carte.

Régénérer le fichier après un changement de manuel (l'ordre figé est conservé) :

```bash
python3 ops/hermes-scripts/regen-fleur-deck.py /chemin/vers/fleur-amours
```
