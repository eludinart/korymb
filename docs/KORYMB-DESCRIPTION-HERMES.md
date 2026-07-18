# Korymb — description complète (contexte pour Hermes)

> Document de référence à donner à **Hermes Agent** (mémoire, skill, ou prompt système) pour qu’il comprenne ce qu’est Korymb, à quoi il sert, et comment il s’inscrit dans l’écosystème Élude In Art.
>
> **URLs production** : https://korymb.eludein.art · API : https://api-korymb.eludein.art  
> **Dépôt code** : repo `korymb` (admin Next.js + backend FastAPI)  
> **Hébergement** : VPS Coolify (même serveur qu’Hermes, services distincts)

---

## 1. En une phrase

**Korymb** est le **quartier général IA d’Élude In Art** : une plateforme web où le dirigeant (Éric) **cadre, lance, supervise et valide des missions** confiées à une **équipe d’agents IA spécialisés**, avec orchestration multi-étapes, livrables (dont Google Drive), contrôle qualité, budget, et mémoire d’entreprise.

Ce n’est **pas** un simple chatbot. C’est un **système d’exploitation métier** pour déléguer du travail structuré (commercial, réseaux sociaux, développement, compta, stratégie) dans le cadre précis de la marque Élude In Art.

---

## 2. Pour qui, pour quoi

### Porteur de projet

- **Éric** — Élude In Art, Tourves (83170, Var)
- Contact : eludinart@gmail.com · 06 59 58 24 28
- Site : https://eludein.art
- Application produit phare : https://app-fleurdamours.eludein.art

### Mission d’Élude In Art

Promouvoir et déployer le **Tarot Fleur d’ÅmÔurs** et l’écosystème associé :

| Élément | Description |
|--------|-------------|
| **Fleur d’ÅmÔurs** | Tarot de 65 cartes — **outil d’analyse systémique des relations**, pas de divination |
| **8 formes d’amour** | Agapé, Éros, Philia, Storgé, Pragma, Ludus, Mania, Philautia |
| **Cycle végétal** | Racines → Nectar |
| **Éléments** | Feu, Éther, Eau, Air, Terre (+ cycles) |
| **Cible** | Coachs, thérapeutes, facilitateurs, couples, pros de l’accompagnement |
| **Modules Pro** | 7 modules pour former des professionnels à l’usage du tarot |
| **Autres activités** | Constellations systémiques, accompagnement relationnel, **VIBRÆ** (son), **SÏvåñà** (écolieu Haut-Var), stages & ateliers |
| **Modèle économique** | Vente tarot physique, séances, modules pro, abonnements Stripe |

### Contraintes éthiques et opérationnelles (à respecter)

- Posture **non divinatoire**, systémique, responsable
- **SÏvåñà** : écolieu réel — les propositions doivent rester **exécutables sur le terrain**
- **TI SPOUN** : ancrage local, artisanal, relationnel — éviter les stratégies déconnectées de la capacité réelle

---

## 3. Ce que fait Korymb (vue utilisateur)

### Écrans principaux

| Zone | Rôle |
|------|------|
| **Briefing** (`/briefing`) | Vue du jour : décisions, missions actives, budget, analytics 24h |
| **Dashboard** | Tableau de bord opérationnel |
| **Missions** (`/missions`) | Lancer, suivre, valider des missions multi-agents |
| **Mission guidée / nouvelle** | Création de mission (cadrage puis exécution) |
| **Chat** | Dialogue avec le dirigeant (cadrage ou échanges) |
| **Inbox** (`/inbox`) | File d’attente dirigeant : validations HITL, clôtures, questions, scheduler, qualité |
| **Livrables** | Bibliothèque des livrables produits |
| **Historique** | Missions et jobs passés |
| **Configuration** | Provider LLM, modèle, paramètres runtime (sans secrets en clair côté UI) |
| **Administration** | Agents custom, playbooks, intégrations, budget, mémoire, orchestration, comportements |

### Cycle de vie d’une mission (simplifié)

```
1. Cadrage     → Le dirigeant précise l’intention (chat ou formulaire mission)
2. Lancement    → Le CIO (agent coordinateur) décompose et délègue aux agents spécialisés
3. Exécution    → Jobs asynchrones, outils (web, Drive, réseaux, DB…), traces auditables
4. HITL         → Points de validation humaine si nécessaire (Human-in-the-Loop)
5. Qualité      → Garde-fou score minimum avant clôture (configurable)
6. Clôture      → Validation dirigeant, livrables archivés (app + Drive si applicable)
7. Mémoire      → Enrichissement de la mémoire d’entreprise pour les missions suivantes
```

### Modes importants

- **Mode cadrage** : échange sans lancer le pipeline multi-agents — le dirigeant valide ensuite dans l’app
- **Mode exécution** : orchestration réelle (legacy ou **LangGraph** selon réglage `orchestration.engine`)
- **Playbooks** : bibliothèque de scénarios prêts à lancer (thèmes Fleur / Sivana)

---

## 4. L’équipe d’agents intégrée

Korymb simule une **petite équipe** avec des rôles fixes :

| Clé | Rôle | Spécialité |
|-----|------|------------|
| **coordinateur** | **CIO** — Orchestrateur | Stratégie, décomposition, délégation, synthèse, validation interne |
| **commercial** | Commercial | Prospection, emails, leads (coachs, thérapeutes, facilitateurs) |
| **community_manager** | Community Manager | Instagram, Facebook, contenu autour de Fleur d’ÅmÔurs |
| **developpeur** | Développeur | Korymb, app Fleur d’ÅmÔurs, backend FastAPI, infra Coolify/Docker |
| **comptable** | Comptable | Finances micro-entreprise, devis, factures |

Des **agents personnalisés** peuvent être ajoutés en administration (pétales / compétences configurables).

Le **CIO** est le seul « manager » : il ne mobilise les autres agents que si leur expertise est nécessaire — pas de déploiement systématique de toute l’équipe.

### Module Gestion métier (CRM intégré)

Korymb inclut un **cockpit Gestion** (`/gestion` dans l’admin) : contacts/prospects, projets, planning, devis. Les **factures légales** passent par **Tiime** (PA / facturation électronique) — Korymb prépare les devis et enregistre les références facture Tiime.

Les agents **commercial**, **comptable** et **coordinateur** disposent d’outils `gestion_*` (préférés aux outils CRM externes type Notion/HubSpot pour Élude In Art) :

| Outil | Usage |
|-------|--------|
| `gestion_search_contacts` / `gestion_upsert_contact` | Prospection : chercher avant créer, enrichir la fiche avec **toutes** les données trouvées (notes, tags) |
| `gestion_log_interaction` / `gestion_list_interactions` | Historique relationnel (prospection, email, devis, mission…) |
| `gestion_create_project` / `gestion_schedule_event` | Projets stages/séances et planning |
| `gestion_create_quote` | Devis Korymb (lignes, totaux) |
| `gestion_request_tiime_invoice` | Demande facture Tiime (sandbox si activé) |

Chaque action agent est tracée avec `agent_key` et `job_id` de la mission en cours. L’UI Contacts affiche cet historique par fiche.

---

## 5. Capacités techniques (backend)

### Stack

- **Frontend** : Next.js (`admin/`) — auth JWT, multi-workspace (multi-tenant)
- **Backend** : FastAPI (`backend/`) — port 8020 en dev, orchestration LLM
- **Base** : MariaDB en production (Coolify) ; SQLite possible en dev local
- **Orchestration** : LangGraph (checkpoints SQLite) ou moteur legacy
- **Déploiement** : Docker + Coolify sur VPS

### Outils que les agents peuvent utiliser (selon rôle)

Recherche web (Tavily, Brave, DuckDuckGo), Google Drive/Docs/Sheets, email SMTP, Meta/Instagram/Facebook, LinkedIn, CRM, paiements (Stripe/PayPal), base de données métier, messagerie, médias, YouTube, Pinterest, WhatsApp, webhooks sortants (n8n/Zapier), etc.

Les clés d’intégration sont dans `.env` / configuration runtime — **ne jamais les exposer dans un chat**.

### Fonctionnalités plateforme notables

- Estimation de **coût** avant vol (`/missions/estimate-cost`)
- **Audit / replay** de jobs (`audit-bundle`, `traces`, `clone`)
- **Scheduler** : tâches planifiées avec approbation dirigeant
- **Notifications** in-app (SSE) + email / webhook
- **Mémoire d’entreprise** par workspace
- **Reprise** après incident (admin reprise)
- **Recommandations** et **apprentissage** suggéré

---

## 6. Configuration LLM

- Provider et modèle sont **dynamiques** (configurables dans l’UI `/configuration`, persistés en base)
- Baseline dans `backend/.env`, surcharges runtime en DB (`llm_runtime_settings`)
- **Ne jamais hardcoder** un provider/modèle dans la logique métier
- Secrets alignés : `AGENT_API_SECRET` (backend) = `KORYMB_AGENT_SECRET` (frontend)

---

## 7. Korymb vs Hermes — complémentarité

| | **Korymb** | **Hermes Agent** |
|---|------------|------------------|
| **Nature** | Application métier structurée | Agent autonome généraliste 24/7 |
| **Utilisateur** | Dirigeant via UI web | Dashboard web + Telegram + TUI |
| **Force** | Missions, HITL, qualité, équipe métier, Drive, playbooks | Ops VPS, SSH, cron, code, exploration, skills |
| **Mémoire** | MariaDB workspace + mémoire entreprise Korymb | `/opt/data` Hermes (sessions, skills, cron) |
| **URL** | korymb.eludein.art | hermes.eludein.art |

**Hermes peut aider Korymb** en : surveillant le VPS, exécutant des commandes SSH, préparant des contenus, alertant sur des incidents, **interrogeant la base Korymb en lecture seule** (skill `korymb-analytics`, script `korymb-sql.sh`), ou en appelant l’API Korymb (briefing, lancement mission).

### Connexion à la base Korymb (Hermes)

Hermes lit la MariaDB Korymb **sans configuration manuelle** :

```bash
# Test connexion
/opt/data/scripts/korymb-sql.sh "SELECT COUNT(*) AS n FROM korymb_workspaces LIMIT 1"

# Requête métier (toujours filtrer le workspace prod)
/opt/data/scripts/korymb-sql.sh "
SELECT status, COUNT(*) n FROM jobs
WHERE workspace_id = 'ws-default-legacy'
GROUP BY status LIMIT 20
"
```

| Élément | Détail |
|---------|--------|
| Script | `/opt/data/scripts/korymb-sql.sh` |
| Credentials | `/opt/data/.env` → `KORYMB_DB_*` (user `hermes_readonly`, SELECT only) |
| Base | `default` sur conteneur MariaDB Coolify |
| Workspace Élude In Art | `ws-default-legacy` |
| Skill | `korymb-analytics` |
| Écritures / missions | **API** `https://api-korymb.eludein.art` — jamais SQL |

Doc Fleur (app tarot) : skill `fleur-analytics`, script `/opt/data/scripts/fleur-sql.sh` — voir `docs/HERMES-FLEUR-DATABASE.md`. Routage global : skill `eludein-ecosystem`.

Doc détaillée : `docs/HERMES-KORYMB-DATABASE.md`

**Korymb ne remplace pas Hermes** pour l’administration bas niveau du serveur ou l’autonomie Telegram.

**Cursor** (IDE) est la couche **développement** du repo Korymb + doc ops (`docs/ADMINISTRATION.md`).

---

## 8. Ce qu’Hermes doit savoir pour bien répondre

### Quand on parle de Korymb, penser :

- Missions **cadrées** puis **validées** par le dirigeant
- Livrables **concrets** (courriers, tableaux, posts) — pas seulement des résumés
- Marque **Élude In Art** / **Fleur d’ÅmÔurs** — ton maïeutique, pas pushy
- **Pas de divination** — cartographie relationnelle systémique
- CIO = point d’entrée stratégique ; agents spécialisés = exécution ciblée

### Erreurs à éviter

- Confondre Korymb avec Hermes ou avec l’app Fleur d’ÅmÔurs (produit tarot utilisateur final)
- Proposer des actions hors capacité réelle (SÏvåñà, micro-entreprise)
- Inventer des liens Google Drive ou des intégrations non configurées
- Modifier la prod Korymb sans passer par les workflows (Coolify, migrations, secrets)

### Commandes utiles côté ops (même VPS qu’Hermes)

```bash
# Santé API Korymb (depuis le VPS ou tunnel)
curl -s https://api-korymb.eludein.art/health

# Dev local (machine Éric, Windows)
# .\start-dev-cursor.ps1 -MariaDbTunnel
```

---

## 9. Glossaire rapide

| Terme | Sens |
|-------|------|
| **Mission** | Unité de travail déléguée aux agents (objectif + livrables) |
| **Job** | Exécution technique asynchrone d’une mission (suivi, annulation, traces) |
| **HITL** | Human-in-the-Loop — validation humaine requise à une étape |
| **CIO / coordinateur** | Agent orchestrateur stratégique |
| **Playbook** | Scénario de mission pré-défini |
| **Workspace** | Espace Korymb isolé (multi-tenant) |
| **Livrable** | Production finale marquée `#### LIVRABLE — titre` |
| **Briefing** | Synthèse quotidienne pour le dirigeant |

---

## 10. Documents liés (repo Korymb)

| Fichier | Contenu |
|---------|---------|
| `ARCHITECTURE.md` | Architecture technique, LangGraph, HITL |
| `COOLIFY_HARDENING.md` | Déploiement production |
| `docs/DEMARRAGE.md` | Dev local Windows + tunnel MariaDB |
| `docs/ADMINISTRATION.md` | Ops VPS Korymb + Hermes |
| `docs/HERMES-KORYMB-DATABASE.md` | Accès SQL lecture seule Hermes → MariaDB Korymb |
| `docs/HERMES-FLEUR-DATABASE.md` | Accès SQL lecture seule Hermes → app Fleur d'ÅmÔurs |
| `backend/services/agents.py` | Définitions agents et contexte métier (source de vérité prompts) |

---

*Dernière mise à jour : juillet 2026 — à synchroniser si l’offre produit ou les agents changent.*
