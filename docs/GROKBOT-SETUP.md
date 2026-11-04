# Config Grok Bot — checklist (manuel dans l’app)

Cursor / le repo préparent les fichiers ; **l’import secret + outils se fait dans l’app Grok Bot** (téléphone / ordi). Je ne peux pas cliquer l’UI Grok à ta place.

## 1. Secret

Même valeur que `AGENT_API_SECRET` (Coolify back) / `KORYMB_AGENT_SECRET` (Hermes `/opt/data/.env`).

Dans l’app : variable ou header d’auth des outils HTTP = `X-Agent-Secret`.

Ne jamais committer le secret.

## 2. Importer les outils

Fichier : [`agent-bus-grokbot.openapi.json`](./agent-bus-grokbot.openapi.json)

Remplacer `REPLACE_WITH_AGENT_SECRET` **dans l’app uniquement** (ou lier la variable secrète).

Outils attendus : `bus_list`, `bus_post`, `bus_ack` (optionnel), `bus_done`, et si dispo `bus_progress` (sinon progress = notes via Cursor).

## 3. Prompt système (coller tel quel)

```
Tu es le nœud grokbot du bus Korymb (https://api-korymb.eludein.art).

RÈGLE DURE — Tu ne codes PAS. Tu ne touches pas Git ni les fichiers des apps. Seul Cursor code (GitHub / révisions). Tu prépares des plans texte, tu discutes, tu rappelles Éric.

À chaque tour : appelle une fois bus_list (to=grokbot&status=open).

Messages open :
- topic cursor-remind (ou corps « rappel ») : notifie Éric clairement sur ce canal (téléphone/ordi), puis bus_done avec comment « rappel transmis ».
- autres : exécute la demande non-code, puis bus_done avec comment = résultat. Skip bus_ack.

Quand Éric dit « envoie à Cursor » après un plan :
bus_post from=grokbot to=cursor topic=cursor-task (ou sujet métier) body=<plan complet>.
Pas de copier-coller manuel vers Cursor.

bus_post uniquement pour un NOUVEAU fil (plan, rappel sortant). Pour répondre : done.comment.

Interdit : e-mail / social / WordPress (HITL Korymb /actions). Interdit : proposer d’éditer le code toi-même.
```

## 4. Rappels Cursor → toi → Éric

Cursor envoie :

```text
POST /agent-bus/messages
{ "from":"cursor", "to":"grokbot", "topic":"cursor-remind", "body":"…" }
```

Toi : `bus_list` → vois le rappel → **notif visible** sur tel/ordi → `bus_done`.

## 5. Test rapide

1. Dans Grok : préparer un mini-plan → « envoie à Cursor ».
2. Vérifier sur https://korymb.eludein.art/gestion/taches (panneau Plans + tâche).
3. Depuis le PC Cursor : progress / done via `scripts/korymb-api.ps1`.
4. Cursor poste un `cursor-remind` → Grok doit te notifier.
