---
name: korymb-mission-bridge
description: Pont Cursor → Korymb — formater missions, appeler l'API (health, briefing, inbox, tickets), lancer un cadrage. Secrets via env locale, jamais en git.
icon: link
color: cyan
---

# Pont Cursor ↔ Korymb

## URLs

- UI Décisions : https://korymb.eludein.art/inbox  
- UI Briefing : https://korymb.eludein.art/briefing  
- API : https://api-korymb.eludein.art  

## Auth API

Header : `X-Agent-Secret: <AGENT_API_SECRET>`  
Variable locale recommandée : `KORYMB_AGENT_SECRET` (identique au backend).  
**Ne jamais** committer le secret.

Scripts prêts :

```powershell
.\scripts\create-korymb-mission.ps1 -Title "..." -BodyFile .\tronc\templates\mission-from-cursor.md
.\scripts\korymb-api.ps1 -Method GET -Path /health
```

```bash
./scripts/korymb-api.sh GET /health
./scripts/create-korymb-mission.sh --title "..." --body-file tronc/templates/mission-from-cursor.md
```

## Ce que Cursor peut faire sans accord spécial

- Rédiger le brief (template mission)
- `GET /health`, `GET /admin/briefing`, `GET /admin/inbox` (si secret dispo)
- Demander à Éric de coller le brief dans une **session de cadrage** UI

## Ce qui exige accord explicite d'Éric

- `POST /run` (lance mission agents / coûts tokens)
- Approve / reject d'actions d'envoi
- Toute écriture hors ticket `POST /actions` de signalement

Le script `create-korymb-mission` par défaut crée un **fichier brief** + optionnellement `POST /actions` (ticket), **pas** `/run`.

## Contenu minimal d'une mission

Voir `tronc/templates/mission-from-cursor.md` :

- Repo GitHub
- Objectif + acceptance criteria
- Preuves (Hermes ou repro)
- Hors scope

## Après validation

Passer la main à l'implémentation (`boucle-operationnelle` étape 3) avec le `job_id` / lien mission si connu.

## Agent bus (Cursor ↔ Grokbot)

**Règle :** Grokbot prépare des plans et rappelle Éric ; **seul Cursor code** (Git + révisions). Le bus porte du texte (plans, rappels), pas des patches hors Cursor.

```powershell
# Plans reçus de Grokbot (pas de copier-coller)
.\scripts\korymb-api.ps1 -Method GET -Path "/agent-bus/messages?to=cursor&status=open"

# Rappel / info vers Grokbot (tel/ordi)
.\scripts\korymb-api.ps1 -Method POST -Path /agent-bus/messages -Body @{
  from = "cursor"; to = "grokbot"; topic = "cursor-remind"
  body = "Rappel: …"
}

# Avancement en parallèle (écrit la tâche Corimb + notif)
.\scripts\korymb-api.ps1 -Method POST -Path "/agent-bus/messages/<id>/progress" -Body @{ note = "…" }

# Clôturer : done.comment = résultat (économe) — marque la tâche done
.\scripts\korymb-api.ps1 -Method POST -Path "/agent-bus/messages/<id>/done" -Body @{ comment = "…" }
```

`from` côté Cursor = `cursor`. Un `to=cursor` crée automatiquement une tâche dans `/gestion/taches`. Voir `docs/AGENT-BUS-GROKBOT.md` + `docs/agent-bus-grokbot.openapi.json`.

**Secret prod :** `KORYMB_AGENT_SECRET` (Hermes `/opt/data/.env`) ou `AGENT_API_SECRET` Coolify back — le `backend/.env` local peut différer.
