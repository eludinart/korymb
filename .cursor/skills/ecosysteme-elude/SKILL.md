---
name: ecosysteme-elude
description: Carte de l'écosystème Élude In Art — eludein.art, Fleur, Korymb, Mandala, OpenPlotter Ti Spoun, VPS Coolify, Hermes. À lire dès qu'un agent travaille sur ces projets ou le choix Cursor vs Hermes.
icon: book-open
color: brand
---

# Écosystème Élude

Banque de contexte pour **ne jamais réduire** le travail d'Eric à un seul projet. Lire ce skill en premier, puis le skill métier concerné.

## Qui / quoi

- **Personne :** Eric Ludinart (Élude In Art)
- **Site marque :** https://eludein.art — structure, systémique, accompagnement
- **GitHub apps :** compte [`eludinart`](https://github.com/eludinart)
- **VPS / Coolify :** `187.124.42.135` — héberge Fleur, Korymb, Mandala, MariaDB, **Hermes Agent**
- **Hermes WebUI :** https://hermeswebui.eludein.art

## Carte des projets

| Projet | Rôle | Prod | Repo | Skill |
| --- | --- | --- | --- | --- |
| **eludein.art** | Marque, contenu, boutique, SEO | [eludein.art](https://eludein.art) | (WordPress hébergé — pas le même repo Next) | ce skill |
| **Fleur d'AmOurs** | Tarot / cartographie relationnelle + app Jardin | [Jardin](https://app-fleurdamours.eludein.art/jardin) | [eludinart/fleur-amours](https://github.com/eludinart/fleur-amours) | `fleur-damours` |
| **Korymb** | QG IA multi-tenant (missions, HITL, vitrine) | [korymb](https://korymb.eludein.art) · [API](https://api-korymb.eludein.art) | [eludinart/korymb](https://github.com/eludinart/korymb) | `korymb` |
| **Mandala** | Lieux & communautés (carte, mur, ressources) | [mandala](https://mandala.eludein.art) | [eludinart/workspace-mandala](https://github.com/eludinart/workspace-mandala) | `mandala` |
| **OpenPlotter Ti Spoun** | Stack marine bateau | RPi5 LAN | (programmes sur Pi) | `openplotter-ti-spoun` |
| **Hermes + VPS** | Ops, briefings, SQL readonly, smoke | WebUI + SSH VPS | skills dans `korymb/ops` + data VPS | `hermes-vps` |

Détail : [references/carte-projets.md](references/carte-projets.md).

## Cursor vs Hermes

| Besoin | Outil |
| --- | --- |
| Coder / PR / tests dans un repo | **Cursor** (Desktop ; Cloud OK si pas LAN) |
| Éditer programmes sur le RPi | **Cursor Desktop + Remote-SSH** |
| Briefing, alertes, analyses DB readonly, mémoire ops | **Hermes** sur le VPS |
| Déploiement apps | **Coolify** (souvent push Git → build) |

## Ports dev locaux (anti-collision)

| App | Next / UI | Notes DB tunnel |
| --- | --- | --- |
| Korymb | 3000 (+ API 8020) | MariaDB local 3307 → VPS |
| Fleur | 3001 | 3307 → VPS 3306 (selon guide Fleur) |
| Mandala | 3002 | 3308 → VPS 3307 |

## Conventions

1. Français produit / com ; code selon conventions du repo.
2. Ton : structure, clarté, circulation — pas de lorem.
3. Secrets jamais en git (`sync-config.env`, Coolify env, Hermes `.env`).
4. Avant d’installer un skill.sh générique : vérifier qu’il sert **ce** projet.
5. Si la carte Cursor change : **miroiter** vers Hermes (`eludein-ecosystem` / mémoires VPS) quand pertinent.

## Quand charger quel skill

- Second cerveau / amélioration env / multi-nœuds → **`second-cerveau`** (+ ce skill)
- Boucle bout-en-bout → `boucle-operationnelle`
- Créer mission Korymb → `korymb-mission-bridge`
- Clôturer mission → `memoire-outcomes`
- Fleur → `fleur-damours`
- Korymb produit → `korymb`
- Mandala → `mandala`
- RPi / OpenPlotter → `openplotter-ti-spoun`
- VPS / Coolify / Hermes / SQL ops → `hermes-vps`
