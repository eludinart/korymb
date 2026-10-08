"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { agentHeaders, requestJson } from "../../../lib/api";
import ContextOffers, { type ContextOffer } from "../../../components/context/ContextOffers";

type GuideEntity = {
  name?: string;
  entity_type?: string;
  attributes?: Record<string, string>;
  relations?: Record<string, string[]>;
};

type GuideTurn = {
  question?: string;
  answer?: string;
  recorded?: string;
  at?: string;
};

type GuideState = {
  phase?: "ask" | "confirm" | "hold";
  question?: string;
  hold_message?: string;
  notice?: string;
  question_stale?: boolean;
  pending?: {
    question?: string;
    answer?: string;
    summary?: string;
    memory?: Record<string, string>;
    facts?: Record<string, string>;
    entities?: GuideEntity[];
  } | null;
  turns?: GuideTurn[];
  context_preview?: string;
  known_entities?: string[];
  started?: boolean;
  offers?: ContextOffer[];
  offers_mode?: "standards" | "gaps";
  view?: "list" | "form";
};

const MEMORY_LABELS: Record<string, string> = {
  global: "Contexte",
  commercial: "Offre",
  comptable: "Chiffres",
  community_manager: "Ton",
  developpeur: "Outils",
};

const FACT_LABELS: Record<string, string> = {
  brand: "Nom",
  location: "Lieu",
  offers: "Offre",
  tone: "Ton",
  tagline: "Formule",
  activity: "Activité",
};

export default function ContexteGuidePage() {
  const [state, setState] = useState<GuideState | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await requestJson("/context-guide", { headers: agentHeaders() });
    setState(data as GuideState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestJson("/context-guide", { headers: agentHeaders() })
      .then(({ data }) => {
        if (!cancelled) setState(data as GuideState);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Chargement impossible.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(path: string, body?: unknown) {
    const restoreAnswer = path.endsWith("/revise") ? state?.pending?.answer || "" : "";
    setBusy(true);
    setError("");
    try {
      const { data } = await requestJson(path, {
        method: "POST",
        headers: agentHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        timeoutMs: 60_000,
      });
      setState(data as GuideState);
      if (!path.endsWith("/dismiss")) setDraft(restoreAnswer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  const phase = state?.phase || "ask";
  const pending = state?.pending;
  const hasOffers = (state?.offers?.length || 0) > 0;
  const opening = "Décrivez avec vos mots ce que vous voulez suivre dans cet espace.";
  const view =
    state?.view || (state?.question && state.question !== opening ? "form" : "list");
  const showForm = Boolean(state) && (view === "form" || phase === "confirm" || !hasOffers);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700">Science de l&apos;entreprise</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900">Prise de connaissance</h1>
        {showForm ? (
          <p className="mt-2 text-sm text-slate-600">
            Une réponse à la fois. Elle rejoint la science de l&apos;entreprise seulement après votre confirmation.
          </p>
        ) : null}
      </header>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {!state && !error ? <p className="text-sm text-slate-500">Chargement…</p> : null}

      {state?.notice ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{state.notice}</p>
      ) : null}

      {state?.question_stale ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="text-sm text-violet-950">
            Le contexte a évolué depuis la dernière question, par ici ou par une mission confirmée.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("/context-guide/refresh")}
            className="mt-2 rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
          >
            {busy ? "Préparation…" : "Poser une question à partir du contexte actuel"}
          </button>
        </div>
      ) : null}

      {state && phase === "confirm" && pending ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {hasOffers ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("/context-guide/list")}
              className="mb-3 text-sm font-semibold text-violet-700 hover:underline disabled:opacity-40"
            >
              ← Retour à la liste
            </button>
          ) : null}
          <p className="text-sm font-bold text-slate-900">J&apos;enregistre</p>
          <p className="mt-2 text-sm text-slate-800">{pending.summary}</p>
          <p className="mt-3 text-xs text-slate-500">Votre réponse : {pending.answer}</p>
          <ProposalDetails pending={pending} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("/context-guide/confirm")}
              className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
            >
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("/context-guide/revise")}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Modifier ma réponse
            </button>
          </div>
        </section>
      ) : null}

      {state && !showForm ? (
        <section className="rounded-2xl border-2 border-violet-200 bg-white p-4 shadow-sm sm:p-5">
          <p className="text-xs font-extrabold uppercase tracking-wider text-violet-700">Début du parcours</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Dire ce qu&apos;est l&apos;entreprise</h2>
          <p className="mt-2 text-sm text-slate-600">
            C&apos;est ici que commence la science de l&apos;entreprise. Aucun métier n&apos;est supposé. Vous décrivez
            avec vos mots ; la question s&apos;ouvre seule, et seule une réponse confirmée est retenue.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("/context-guide/form")}
            className="mt-4 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
          >
            {busy ? "Ouverture…" : "Commencer par vos mots"}
          </button>
        </section>
      ) : null}

      {state && !showForm ? (
        <ContextOffers
          offers={state.offers || []}
          mode={state.offers_mode}
          busy={busy}
          onOpen={(id) => void run("/context-guide/focus", { id })}
          onDismiss={(id) => void run("/context-guide/dismiss", { id })}
        />
      ) : null}

      {state && showForm && phase !== "confirm" && hasOffers ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run("/context-guide/list")}
          className="text-sm font-semibold text-violet-700 hover:underline disabled:opacity-40"
        >
          ← Retour à la liste
        </button>
      ) : null}

      {state && showForm && phase !== "confirm" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {phase === "hold" ? (
            <p className="text-sm text-slate-800">{state.hold_message}</p>
          ) : (
            <p className="text-base font-semibold text-slate-900">{state.question}</p>
          )}
          <label className="mt-4 block text-sm font-semibold text-slate-800" htmlFor="context-guide-answer">
            {phase === "hold" ? "Ajouter quelque chose" : "Votre réponse"}
          </label>
          <textarea
            id="context-guide-answer"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            disabled={busy}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
            placeholder={phase === "hold" ? "Un fait, un nom, une contrainte…" : "Avec vos mots"}
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void run("/context-guide/answer", { answer: draft.trim() })}
            className="mt-3 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
          >
            {busy ? "Lecture…" : phase === "hold" ? "Proposer cet ajout" : "Répondre"}
          </button>
        </section>
      ) : null}

      {state && !showForm && state.context_preview ? (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Déjà dans le contexte</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{state.context_preview}</p>
          {state.known_entities && state.known_entities.length > 0 ? (
            <p className="mt-2 text-xs text-slate-600">Fiches : {state.known_entities.join(", ")}</p>
          ) : null}
        </section>
      ) : null}

      {state && !showForm && state.turns && state.turns.length > 0 ? (
        <section>
          <h2 className="text-sm font-bold text-slate-900">Déjà retenu par le guide</h2>
          <ol className="mt-2 space-y-2">
            {state.turns.map((turn, index) => (
              <li key={`${turn.at || index}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs text-slate-500">{turn.question}</p>
                <p className="mt-1 text-sm text-slate-800">{turn.recorded}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="text-sm text-slate-600">
        <Link href="/administration/memory" className="font-semibold text-violet-700 hover:underline">
          Voir la mémoire
        </Link>
        {" · "}
        <button type="button" className="font-semibold text-violet-700 hover:underline" onClick={() => void load().catch(() => undefined)}>
          Recharger
        </button>
      </p>
    </div>
  );
}

function ProposalDetails({ pending }: { pending: NonNullable<GuideState["pending"]> }) {
  const summary = String(pending.summary || "").trim();
  const memory = Object.entries(pending.memory || {}).filter(([, value]) => {
    const text = String(value || "").trim();
    return Boolean(text) && text !== summary;
  });
  const facts = Object.entries(pending.facts || {}).filter(([, value]) => String(value || "").trim());
  const entities = pending.entities || [];
  if (!memory.length && !facts.length && !entities.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm text-slate-700">
      {memory.map(([key, value]) => (
        <li key={key}>
          <span className="font-semibold">{MEMORY_LABELS[key] || key} : </span>
          {value}
        </li>
      ))}
      {facts.map(([key, value]) => (
        <li key={key}>
          <span className="font-semibold">{FACT_LABELS[key] || key} : </span>
          {value}
        </li>
      ))}
      {entities.map((entity) => (
        <li key={entity.name}>
          <span className="font-semibold">Fiche {entity.name}</span>
          {entity.entity_type ? ` (${entity.entity_type})` : ""}
        </li>
      ))}
    </ul>
  );
}
