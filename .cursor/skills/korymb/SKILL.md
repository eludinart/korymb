---
name: korymb
description: App Korymb — QG IA multi-tenant (missions, HITL, briefing, vitrine /p/, espace participant /a/). Repo github.com/eludinart/korymb. Next.js admin + FastAPI. Prod korymb.eludein.art / api-korymb.eludein.art.
icon: rocket
color: cyan
---

# Korymb

**Prod UI :** https://korymb.eludein.art  
**API :** https://api-korymb.eludein.art  
**Repo :** https://github.com/eludinart/korymb  

Plateforme **multi-tenant** d’orchestration d’agents IA : cadrer, lancer, superviser et **valider** des missions. L’assistant prépare ; l’humain valide (HITL). Pas un simple chatbot.

Sur l’instance Élude, le workspace historique `ws-default-legacy` porte le pack métier Élude / Fleur — c’est un **locataire**, pas la définition du produit.

## Repo & chemins

| | |
| --- | --- |
| **GitHub** | https://github.com/eludinart/korymb |
| **Structure** | `admin/` Next.js · `backend/` FastAPI · `docs/` · `ops/` (skills Hermes) |
| **Dev Windows** | `.\start-dev-cursor.ps1 -MariaDbTunnel` |
| **Ports locaux** | Frontend **3000** · Backend **8020** · tunnel MariaDB **3307** |
| **Docs utiles** | `ARCHITECTURE.md`, `docs/DEMARRAGE.md`, `docs/KORYMB-DESCRIPTION-HERMES.md`, `docs/HERMES-*.md` |

## Stack

- **Next.js** (`admin/`) — cockpit `/briefing`, missions, inbox HITL, gestion, admin ; vitrine `/p/{slug}` ; espace participant `/a/{slug}`
- **FastAPI** (`backend/`) — orchestration, LLM providers, jobs, persistence
- Orchestration : legacy / **LangGraph** / shadow
- **MariaDB** Coolify ; starter packs `blank` \| `accompagnement` \| `contenu`
- UI modes : `essential` (défaut) / `advanced`
- Secrets alignés : `AGENT_API_SECRET` (backend) ↔ `KORYMB_AGENT_SECRET` (admin)

## Univers UI (ne pas mélanger)

| Univers | Qui | Contenu |
| --- | --- | --- |
| Cockpit | Admin / équipe | `/briefing`, missions, `/inbox` (décisions HITL), gestion |
| Participant | Inscrit vitrine | `/a/{slug}` — séances, ressources, compte |
| Vitrine | Public | `/p/{slug}` |

Connexion dirigeant : `/login` · participant : `/p/{slug}/connexion`.

## Instructions agent

1. Charger `ecosysteme-elude` + `hermes-vps` pour ops.
2. Travailler dans **eludinart/korymb** uniquement.
3. Préserver HITL / validation humaine sur tout flux LLM sensible.
4. Provider/model = **runtime settings** (DB), pas hardcodés dans la feature.
5. Hermes : analyses via `korymb-sql.sh` / `korymb-api.sh` — **pas** writer métier.
6. Ne pas confondre avec Fleur (produit tarot) ni Mandala (lieux).

## Lien Hermes

Les skills Hermes ops vivent surtout sous `ops/hermes-skills/` et sur le VPS (`/docker/hermes-agent-aoxw/data/skills/`). Toute évolution de carte écosystème Cursor devrait idéalement être **mirroirée** côté Hermes (`eludein-ecosystem`).
