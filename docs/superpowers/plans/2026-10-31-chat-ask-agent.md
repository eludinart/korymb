# Chat Ask / Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renommer Discussion/Ops en Ask/Agent, placer le sélecteur en pastille dans la barre de saisie, et laisser Essentiel basculer librement (plus de `lockQuotidien`).

**Architecture:** Front-only. Ids `quotidien` / `operationnel` et API inchangés. Labels + placement UI + suppression du forçage Essentiel.

**Tech Stack:** Next.js admin (`admin/`), React client components, `localStorage` via `chatUseMode.ts`.

## Global Constraints

- Labels UI : **Ask** / **Agent** ; hints du spec.
- Ids internes : `quotidien` | `operationnel`.
- Pastille : `[Ask|Agent] [joindre] [textarea…] …` ; désactivée si `pending`.
- Essentiel : sélecteur visible ; Agent = même chrome Ops.
- Retirer le sélecteur Mode du drawer et de More ; garder interlocuteur / Perso.
- Backend : aucun changement.
- Pas de commit sauf demande utilisateur (hors workflow écriture-plan « Step Commit » si l’utilisateur a dit go sans commit).

## File map

| Fichier | Rôle |
| --- | --- |
| `admin/lib/chatUseMode.ts` | Labels / hints |
| `admin/components/chat/ChatShell.tsx` | Pastille composer + `onChatUseModeChange` |
| `admin/app/chat/page.tsx` | Brancher pastille ; supprimer `lockQuotidien` |
| `admin/components/chat/ChatHistoryDrawer.tsx` | Retirer Mode ; interlocuteur si Agent |
| `admin/components/chat/ChatThreadMoreSheet.tsx` | Retirer Mode ; garder Perso |

---

### Task 1: Labels Ask / Agent

**Files:**
- Modify: `admin/lib/chatUseMode.ts`

- [ ] **Step 1:** Remplacer `CHAT_USE_MODE_OPTIONS` :

```ts
export const CHAT_USE_MODE_OPTIONS: { id: ChatUseMode; label: string; hint: string }[] = [
  { id: "quotidien", label: "Ask", hint: "Parler avec Korymb, sans lancer d’ops" },
  { id: "operationnel", label: "Agent", hint: "Flottes, missions, HITL" },
];
```

- [ ] **Step 2:** Mettre à jour le commentaire de tête du fichier (discussion/QG → Ask/Agent).

---

### Task 2: Pastille dans ChatShell

**Files:**
- Modify: `admin/components/chat/ChatShell.tsx`

**Interfaces:**
- Consumes: `CHAT_USE_MODE_OPTIONS`, `ChatUseMode` from `@/lib/chatUseMode` (ou chemin relatif `../../lib/chatUseMode`)
- Produces: props `onChatUseModeChange?: (mode: ChatUseMode) => void`

- [ ] **Step 1:** Ajouter prop `onChatUseModeChange?: (mode: ChatUseMode) => void` à `Props` ; typer `chatUseMode` avec `ChatUseMode`.
- [ ] **Step 2:** Dans la rangée `items-end` du composer, **avant** le bouton joindre, rendre :

```tsx
{onChatUseModeChange ? (
  <div className="mb-0.5 flex shrink-0 gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-950" role="group" aria-label="Mode du chat">
    {CHAT_USE_MODE_OPTIONS.map((opt) => {
      const active = chatUseMode === opt.id;
      return (
        <button
          key={opt.id}
          type="button"
          disabled={pending}
          onClick={() => onChatUseModeChange(opt.id)}
          className={
            active
              ? "rounded-full bg-violet-700 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              : "rounded-full px-2.5 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50 dark:text-slate-300"
          }
          aria-pressed={active}
          title={opt.hint}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
) : null}
```

---

### Task 3: page.tsx — plus de lock Essentiel + wire composer

**Files:**
- Modify: `admin/app/chat/page.tsx`

- [ ] **Step 1:** Supprimer `const { isEssential } = useUiMode();`, `lockQuotidien`, l’effet qui force `quotidien`, et l’usage `lockQuotidien ? "quotidien" : chatUseModeRef.current` → utiliser `chatUseModeRef.current`.
- [ ] **Step 2:** Retirer `lockQuotidien` des deps / props drawer & more.
- [ ] **Step 3:** Passer `onChatUseModeChange={applyChatUseMode}` à `ChatShell`.
- [ ] **Step 4:** Nettoyer import `useUiMode` s’il n’est plus utilisé.

---

### Task 4: Retirer doublons drawer / more

**Files:**
- Modify: `admin/components/chat/ChatHistoryDrawer.tsx`
- Modify: `admin/components/chat/ChatThreadMoreSheet.tsx`
- Modify: `admin/app/chat/page.tsx` (props)

- [ ] **Step 1 (drawer):** Retirer props `onChatUseModeChange`, `lockQuotidien` et le grid Mode. Afficher interlocuteur si `chatUseMode === "operationnel"`. Retirer import `CHAT_USE_MODE_OPTIONS` si inutile. Garder `onOpenPerso` / actions.
- [ ] **Step 2 (more):** Retirer le bloc Mode et props `onChatUseModeChange` / `lockQuotidien`. Si `isQuotidien && onOpenPerso`, garder un bouton « Ouvrir le fil Perso » hors du grid Mode.
- [ ] **Step 3:** Aligner les appels dans `page.tsx`.

---

### Task 5: Vérif

- [ ] Grep : plus de `lockQuotidien` dans `admin/`.
- [ ] Grep : labels « Discussion » / « Ops » hors docs legacy dans `chatUseMode` / chat components.
- [ ] Smoke mental : pastille Ask/Agent composer ; Agent montre convert/interlocuteur ; Ask montre chips.

---

## Spec coverage

| Spec | Task |
| --- | --- |
| Labels Ask/Agent + hints | 1 |
| Pastille composer | 2 |
| Essentiel libre / no lock | 3 |
| Retirer doublons drawer/more | 4 |
| Backend inchangé | (rien) |
| Vérif | 5 |
