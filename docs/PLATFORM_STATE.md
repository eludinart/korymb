# État plateforme Korymb

> Source de vérité **courte** pour le CIO / chat.  
> Mise à jour : après chaque chantier utile (commit + deploy + smoke).  
> Sync mémoire DB : `.\scripts\sync-platform-state-memory.ps1`

**Dernière MAJ :** 2026-09-30 · commits récents `3a40137` (UX toasts/Modèles), `ea314c6`/`f2ffc99` (QCM + mirror ack)

## Produit
- QG IA multi-tenant : missions HITL, chat, inbox Décisions, Gestion, Administration.
- UI : https://korymb.eludein.art · API : https://api-korymb.eludein.art
- Stack : Next.js `admin/` + FastAPI `backend/` · charte **violet** (pas bleu `#0066cc`).
- Modes : Essentiel / Avancé.

## Navigation réelle
- Primaire : Briefing, Carte, Missions, Chat, Inbox, Gestion.
- Mobile : bouton texte **Menu** (pas un ☰ sans label).
- Essentiel Gestion : Contacts, Messages, Planning, Devis, **Modèles** (`/gestion/playbooks`).
- Templates avancés : `/administration/templates`.
- Mémoire : `/administration/memory` · Scheduler : `/administration/autonomie`.
- **Pas** de section produit « Rapports ».

## Chat & QCM
- Question « ce qui marche / ce qui bloque » : deux blocs courts tirés de ce fichier. Pas de roadmap.
- Répondre d’abord ; QCM seulement sur demande explicite.
- QCM interactif = fence `korymb-qcm` + widget cliquable.
- Ne pas inventer un bug CSS `pointer-events: none` sur `.qcm-option`.
- Pièces jointes → orchestration CIO ; mirror ack actif.

## UX récente
- Toast global : Mission lancée / Template enregistré / QCM envoyé / clôture.
- Libellés : **Clôturer** / **Mettre de côté**.
- Journal d’exécution replié.
- Recherche mémoire (volets + snapshots).

## Automatisation
- Playbooks : `/gestion/playbooks` (ex. veille concurrence Fleur seed).
- Récurrence : tâches autonomes (cron/interval), pas un badge HTML inventé.
- WordPress = publication de posts après HITL, **pas** formulaire `/old-contact.php`.

## Déploiements à surveiller
- Front : UX toasts + Modèles Essentiel + QCM surface (`3a40137` et précédents chat).
- Back : QCM promote + mirror ack + stub tests.

## Interdits (hallucinations fréquentes)
- Métriques inventées (% abandon, tests 5s).
- Correctifs « via Resalib » / maquette Figma Drive / patch Apache contact WP.
- Inventer des écrans Accueil / Rapports / Paramètres hors IA Korymb.

## Rituale maintainer
1. Mettre à jour **ce fichier** (dates, commits, à redéployer).
2. `.\scripts\sync-platform-state-memory.ps1` (pousse le volet `developpeur` en mémoire).
3. Smoke : chat « quel est l’état de la plateforme Korymb ? »
