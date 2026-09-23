# Korymb — description complète (contexte pour Hermes)

> Document de référence à donner à **Hermes Agent** (mémoire, skill, ou prompt système) pour qu’il comprenne ce qu’est Korymb et à quoi il sert.
>
> **Produit multi-tenant** : Korymb est une plateforme générique d’orchestration d’agents IA pour une activité (CRM, missions, studio, mémoire). Chaque workspace a sa propre identité (nom, vitrine, mémoire) — rien n’impose la marque Élude In Art.
> **Instance Élude** : sur l’hébergement eludein.art, le workspace historique `ws-default-legacy` porte le pack métier Élude / Fleur ; c’est un locataire parmi d’autres, pas la définition du produit.
>
> **URLs production (instance Élude)** : https://korymb.eludein.art · API : https://api-korymb.eludein.art  
> **Dépôt code** : repo `korymb` (admin Next.js + backend FastAPI)  
> **Hébergement** : VPS Coolify (même serveur qu’Hermes, services distincts)

---

## 1. En une phrase

**Korymb** est un **quartier général IA multi-tenant** : une plateforme web où le dirigeant d’un workspace **cadre, lance, supervise et valide des missions** confiées à une **équipe d’agents IA spécialisés**, avec orchestration multi-étapes, livrables (fichiers dans l’espace Korymb), contrôle qualité, budget, et mémoire d’entreprise.

Ce n’est **pas** un simple chatbot. C’est un **système d’exploitation métier générique** pour déléguer du travail structuré. Le moteur **n’impose aucun secteur** : la spécialisation vient de la mémoire, des agents, des playbooks et, en option, d’un **starter pack** à la création (`blank`, `accompagnement`, `contenu` — voir `docs/STARTER-PACKS.md`). Sur l’instance Élude, le workspace `ws-default-legacy` applique ce cadre à la marque Élude In Art ; d’autres workspaces ont leur propre identité.

---

## 2. Pour qui, pour quoi

### Locataire type (instance Élude — `ws-default-legacy`)

Le contenu ci-dessous décrit **un** workspace de référence sur l’instance hébergée, pas le produit Korymb en général.

- **Éric** — Élude In Art, Tourves (83170, Var)
- Contact : eludinart@gmail.com · 06 59 58 24 28
- Site : https://eludein.art
- Application produit phare : https://app-fleurdamours.eludein.art

### Mission d’Élude In Art (ce workspace)

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

### Deux univers (ne pas confondre)

| Univers | Pour qui | Contenu type |
|---------|----------|----------------|
| **Mon espace** (`/a/{slug}`) | Participant inscrit à la vitrine (`subscriber`) — et aperçu pour le dirigeant | Accueil perso, **mes séances**, **mes ressources**, **mon compte**. Pas de CRM, missions ni HITL |
| **Cockpit dirigeant** (`/briefing` et le reste de l’app) | Admin / membre de l’équipe | Briefing du jour, Décisions, Missions, Chat, Gestion (contacts, courrier, planning, devis), Administration |
| **Vitrine** (`/p/{slug}`) | Public | Page de la pratique (identité, prochaine date, offres) — pas un compte |

La page `/espace` est **Équipe et espaces** (invitations opérateurs), pas « Mon espace ».

Connexion : **Korymb** = `/login` ; **participant** = `/p/{slug}/connexion`. Un créneau planning a une visibilité `internal` | `selected` | `participants` | `public`. `selected` cible des **participants** (`audience_user_ids`), pas les fiches CRM. Inscription = demande à valider ; invitation = e-mail + code (`/p/{slug}/invitation`).

### Écrans principaux

| Zone | Rôle |
|------|------|
| **Briefing** (`/briefing`) | Accueil du **cockpit dirigeant** : décisions, **commercial du matin** (relances, devis, joignabilité), missions actives, budget |
| **Dashboard** | Tableau de bord opérationnel |
| **Missions** (`/missions`) | Suivi quotidien : prochaine action (publier, agenda, décider, terminer) ; mode Dossier pour le détail |
| **Mission guidée / nouvelle** | Création de mission (cadrage puis exécution) |
| **Chat** | Dialogue avec le dirigeant (cadrage ou échanges) |
| **Décisions** (`/inbox`) | File d’attente dirigeant (pas le courrier) : validations HITL, **relances CRM dues**, clôtures, questions, scheduler, qualité |
| **Courrier** (`/gestion/courrier`) | Boîte de **prospection** : réponses à traiter, fils en attente, brouillons HITL. Sync Gmail auto (15 min) |
| **Studio** (`/gestion/studio`) | Générateur de contenus : articles, PDF, podcasts, vidéo, réseaux. Brief + mémoire ; **passes de correction** et texte copiable ; **moteurs média en chaîne**. Publication via Décisions |
| **Playbooks** (`/gestion/playbooks`) | Scénarios prêts à lancer (studio, Fleur, Sivana, ops) ; relire, corriger, copier le livrable |
| **Livrables** (`/gestion/livrables`) | Bibliothèque des livrables produits |
| **Équipes projet** (`/gestion/equipes`) | Contextes de travail avec les autres groupes d’agents (hors flotte Entreprise) : chat, missions, brief d’équipe |
| **Historique** | Missions et jobs passés |
| **Configuration** | Provider LLM, modèle, paramètres runtime (sans secrets en clair côté UI) |
| **Administration** | Agents, **page publique**, **intégrations** (Essentielles / Création / Métier / Technique ; Google et médias regroupés), budget, mémoire, orchestration, comportements (pas la création de contenus) |
| **Vitrine** (`/p/{slug}`) | Face publique de l’espace (offres, dates ouvertes, modalités présentiel/visio/async). Cartes avec **image de couverture** (dédiée ou fichier ressource image). Élude : `/p/eludein` |
| **Mon espace** (`/a/{slug}`) | Compte **participant** : accueil, séances, ressources (mêmes visuels), compte. **Pas** le cockpit (missions, gestion, HITL) |

### Cycle de vie d’une mission (simplifié)

```
1. Cadrage     → Le dirigeant précise l’intention (chat ou formulaire mission)
2. Lancement    → Le CIO (agent coordinateur) décompose et délègue aux agents spécialisés
3. Exécution    → Jobs asynchrones, outils (web, réseaux, DB…), traces auditables
4. HITL         → Deux files distinctes (plan CIO vs envoi réel)
5. Qualité      → Garde-fou score minimum avant clôture (configurable)
6. Clôture      → Validation dirigeant, livrables archivés dans l’espace Korymb
7. Mémoire      → Enrichissement de la mémoire d’entreprise pour les missions suivantes
```

### Deux HITL distincts (ne pas confondre)

| File | Statut / table | Ce que le dirigeant valide | Exécution |
|------|----------------|---------------------------|-----------|
| **Plan CIO** | `jobs.status = awaiting_validation` · `POST /jobs/{id}/hitl/resolve` | Plan d’orchestration, questions, synthèse | Reprise du job — **Valider et lancer** enchaîne validation + reprise des sous-agents |
| **Action** | `action_tickets` (`pending`) · inbox `kind: action_ticket` · `POST /actions/{id}/resolve` | E-mail, agenda, post social, article WordPress | Envoi / publish **seulement après clic** (ou callback Telegram HITL). **E-mail** : envoi + fil CRM (`biz_email_threads` / `biz_email_messages`) + journal + relance J+7. **Social / WordPress** : publish + suivi mesurer/relayer J+3 dans Planning. |
| **Relance CRM** | créneau Planning (`Relance —…` / Mesurer / Relayer) · inbox `kind: crm_follow_up` · `POST /business/events/{id}/prepare-follow-up-email` | Relances dues du jour (et en retard) | Prépare un ticket e-mail HITL, ou marque fait / report +3 j. Remonte aussi dans le **briefing commercial**. |
| **Prospection mail** | fiche contact **ou** Courrier · `POST …/emails/send` + `POST …/emails/suggest-replies` (+ PJ) | Rédiger / **orienter** 3 pistes (consignes + profil + fil) ; **envoyer depuis le rédacteur** ; sync Gmail | Réponse inbound → fil `replied` + annulation auto des relances. Les e-mails agents / relances CRM passent encore par Décisions. |

Les outils `send_email`, `send_gmail`, `create_calendar_event`, posts Meta, `wordpress_create_post` **n’exécutent plus en live** : ils créent un ticket. WordPress (si configuré) crée d’abord un **brouillon** ; l’approbation passe en `publish`. Après un e-mail réellement envoyé, Korymb journalise une interaction CRM (`gestion_log_interaction`).

Telegram : Hermes garde `TELEGRAM_BOT_TOKEN` + `getUpdates`. Pour Valider/Rejeter en 1 clic, un **bot HITL dédié** (`TELEGRAM_HITL_BOT_TOKEN`) + webhook `POST /telegram/webhook` (secret `TELEGRAM_WEBHOOK_SECRET`) — **ne jamais** `setWebhook` sur le bot Hermes.

### Modes importants

- **Assistant (défaut chat)** : atelier dirigeant — clarifier, structurer, **proposer des équipes** (blueprints) sans orchestration métier. Validation UI « Créer l’équipe ».
- **Groupes d’agents** : flotte `entreprise` (système, défaut métier) + équipes projet optionnelles ; délégation restreinte aux membres du groupe. Ops : **Équipes projet** (`/gestion/equipes`) pour ouvrir un contexte (chat, missions, brief). Admin : **Équipes** (`/administration/equipes`) avec onglets Identité / Composition / Politique / Mémoire. Si `memory_scope=group`, injection des notes `agent_group_memory` (héritage optionnel du global partagé) ; sinon mémoire workspace ou aucune. Mémoire partagée workspace : Moteur IA → Mémoire partagée.
- **Mode cadrage** : échange sans lancer le pipeline multi-agents — le dirigeant valide ensuite dans l’app
- **Mode exécution** : orchestration réelle (moteur **legacy** par défaut ; LangGraph gelé)
- **Playbooks** (`/gestion/playbooks`) : bibliothèque de scénarios prêts à lancer (studio, thèmes Fleur / Sivana, relance prospect, article WP, agenda, post social). Le résultat est relisible, corrigeable (nouvelle passe) et copiable.

---

## 4. L’équipe d’agents intégrée

Korymb s’appuie sur une **flotte métier par défaut** (`entreprise`) avec des rôles génériques, plus des **équipes projet** composables pour des périmètres dédiés. Les spécialités ci-dessous sont des **exemples** ; le contenu réel vient de la mémoire et des outils du workspace :

| Clé | Rôle | Spécialité |
|-----|------|------------|
| **assistant** | Assistant | Atelier dirigeant : cadrage, blueprints d’équipes (pas d’orchestration métier) |
| **coordinateur** | **CIO** — Orchestrateur | Stratégie, décomposition, délégation, synthèse, validation interne |
| **commercial** | Commercial | Prospection, emails, leads |
| **community_manager** | Community Manager | Instagram, Facebook, contenu éditorial |
| **developpeur** | Développeur | Plateforme Korymb, backends, infra |
| **comptable** | Comptable | Finances, devis, factures |

Des **agents personnalisés** et des **groupes** (Administration → Équipes d’agents) peuvent être ajoutés. Templates : édition, terrain, R&D. Le tronc commun reste la **gestion d’activité** ; les équipes sont des configurations d’exécution IA.

Le **CIO** (flotte `entreprise`) est le manager métier par défaut : il ne mobilise les autres agents que si leur expertise est nécessaire — pas de déploiement systématique de toute l’équipe. Les autres groupes ont leur propre **lead**.

### Module Gestion métier (CRM intégré)

Korymb inclut un **cockpit Gestion** (`/gestion` dans l’admin) : contacts/prospects, projets, planning, devis, et **équipes projet** (`/gestion/equipes`) pour travailler avec un autre groupe d’agents. La fiche projet liste les **séances**, **documents / vidéos** et **devis** rattachés : un document à ouvrir est un créneau du planning (pas un rendez-vous), pas un module séparé. Les **factures légales** passent par **Tiime** (PA / facturation électronique) — Korymb prépare les devis et enregistre les références facture Tiime.

Les agents **commercial**, **comptable** et **coordinateur** disposent d’outils `gestion_*` (préférés aux outils CRM externes type Notion/HubSpot pour le cockpit intégré) :

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
- **Mémoire d’entreprise** par workspace (volets + faits structurés brand)
- File **Mémoire à confirmer** dans Décisions (mission validée, CRM, sync vitrine)
- Compaction des volets longs + limite d’injection prompts ; chat CIO avec résumé actif
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
| **HITL** | Human-in-the-Loop — plan CIO (`awaiting_validation`) ou ticket d’action (`action_tickets`) |
| **Ticket d’action** | Envoi/publication préparé, exécuté seulement après Valider |
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
| `docs/STARTER-PACKS.md` | Packs d'amorçage optionnels (produit générique) |
| `COOLIFY_HARDENING.md` | Déploiement production |
| `docs/DEMARRAGE.md` | Dev local Windows + tunnel MariaDB |
| `docs/ADMINISTRATION.md` | Ops VPS Korymb + Hermes |
| `docs/HERMES-KORYMB-DATABASE.md` | Accès SQL lecture seule Hermes → MariaDB Korymb |
| `docs/HERMES-FLEUR-DATABASE.md` | Accès SQL lecture seule Hermes → app Fleur d'ÅmÔurs |
| `backend/services/agents.py` | Définitions agents et contexte métier (source de vérité prompts) |

---

*Dernière mise à jour : septembre 2026 — chaînage prospection e-mail (fils CRM + sync Gmail + HITL + pièces jointes) + relances CRM dans Décisions / briefing. L’écran `/inbox` s’affiche **Décisions** pour ne pas le confondre avec le courrier.*
