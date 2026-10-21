# Réponse sur place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre d'écrire une réponse sur une tâche, un jalon ou une question des Décisions, et de la préparer en discutant avec l'assistant du chat.

**Architecture:** Un `ReplyComposer` et un `ReplyDrawer` partagés. Le panneau appelle `POST /chat` (assistant, mode quotidien, sans outils) avec `reply_context`. La réponse enregistrée vit sur la tâche, sur l'objet JSON du jalon, ou en brouillon CIO distinct de la validation.

**Tech Stack:** FastAPI, Pydantic, SQLite/MariaDB, Next.js, React Query.

## Global Constraints

- Enregistrer la réponse ne coche pas la tâche, ne marque pas le jalon fait, et ne lance pas la mission.
- Le commentaire (400 caractères dans `TaskEditDialog`) reste distinct de la réponse (4 000 caractères).
- `reply_context` est envoyé au modèle sous « Sujet de la réponse à préparer : » et n'est pas un message du fil.
- Le fournisseur et le modèle restent ceux des réglages runtime, via `POST /chat`.
- Le bouton Discuter n'apparaît dans `ChoiceQuestionnaire` que si l'appelant le demande.
- Le brouillon CIO n'appelle pas `record_cio_arbitrage_answer`.
- La consigne libre utilise la clé `Consigne libre (hors propositions CIO)`.
- Supprimer une tâche laisse la conversation dans l'historique du chat.

---

### Task 1: Contexte de réponse sur POST /chat

**Files:**
- Modify: `backend/services/assistant_chat.py`
- Modify: `backend/routers/core_chat.py`
- Test: `backend/tests/test_chat_self_awareness.py`

- [ ] Ajouter `reply_context_block` et le paramètre sur `run_assistant_turn` / `run_assistant_chat_sync`.
- [ ] `ChatRequest.reply_context` (max 4000). `_build_chat_mission_txt` le place en tête.
- [ ] Si `reply_context` est non vide et l'agent est `assistant`, répondre en synchrone sans outils.
- [ ] Test : le texte de mission commence par le sujet, et un appel sans contexte ne le contient pas.

### Task 2: Réponse de tâche

**Files:**
- Modify: `backend/services/work_tasks.py`
- Modify: `backend/routers/core_business.py`
- Test: `backend/tests/test_work_tasks.py`

- [ ] Colonnes `reply`, `reply_at`, `chat_conversation_id`.
- [ ] `WorkTaskUpdate` accepte `reply` (max 4000) et `chat_conversation_id` (max 64).
- [ ] Une réponse vide efface `reply_at`. `status` et `notes` ne bougent pas. 4001 caractères → 422.

### Task 3: Réponse de jalon

**Files:**
- Modify: `backend/services/business_db.py`
- Modify: `backend/routers/core_business.py`
- Modify: `backend/services/director_platform.py`
- Test: `backend/tests/test_project_steps_board.py`

- [ ] `set_project_milestone_reply` : écrit `reply`, `reply_at`, et `chat_conversation_id` seulement s'il est fourni. Ne change pas `done`. 409 si le libellé diffère.
- [ ] `POST /business/projects/{id}/milestones/{index}/reply`
- [ ] `build_project_milestones` recopie les trois champs.
- [ ] `update_project` qui renvoie ces champs les conserve.

### Task 4: Brouillon CIO

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/routers/core_jobs.py`
- Test: `backend/tests/test_admin_platform.py`

- [ ] `save_cio_question_draft` écrit `draft_answers` et `reply_conversation_id` sans `cio_arbitrage_answer` et sans `answered`.
- [ ] `PUT /jobs/{job_id}/cio-question-drafts`
- [ ] La consigne libre est acceptée même hors de `questions`.

### Task 5: Champ et panneau

**Files:**
- Create: `admin/lib/replyContext.ts`
- Create: `admin/components/director/ReplyComposer.tsx`
- Create: `admin/components/director/ReplyDrawer.tsx`
- Modify: `admin/lib/business.ts`

- [ ] Le bloc est replié derrière Répondre, ouvert si le titre finit par `?`, si le commentaire contient « attente » et « réponse », ou si une réponse existe.
- [ ] Discuter crée `rcv-` + 12 hex, `PUT` la conversation « Réponse · … », `POST /chat` avec `agent: assistant`, `chat_use_mode: quotidien`, `reply_context`.
- [ ] Utiliser comme réponse confirme si le champ n'est pas vide. Un message assistant vide n'a pas le bouton.

### Task 6: Brancher les surfaces

**Files:**
- Modify: `admin/components/director/TodayTasks.tsx`
- Modify: `admin/app/gestion/taches/page.tsx`
- Modify: `admin/components/director/BriefingBoard.tsx`
- Modify: `admin/app/gestion/projets/[id]/page.tsx`
- Modify: `admin/components/ChoiceQuestionnaire.tsx`
- Modify: `admin/components/CioArbitrageQuestionnaire.tsx`
- Modify: `admin/components/director/InboxActionCard.tsx`
- Modify: `admin/lib/cioArbitrageAnswers.ts`

- [ ] Tâches du briefing et `/gestion/taches` partagent le compositeur.
- [ ] Jalons du briefing et étapes de la fiche projet. La fiche renvoie `reply`, `reply_at`, `chat_conversation_id` à l'enregistrement.
- [ ] Décisions : Discuter sur le texte libre et sur le commentaire, pas sur les cases. Le brouillon est relu au chargement. Valider et lancer reste le geste de mission.
