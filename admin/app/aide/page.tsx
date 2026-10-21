"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../components/ui/PageChrome";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../lib/api";
import { GLOSSARY_ENTRIES } from "../../lib/glossary";

function AideForm() {
  const params = useSearchParams();
  const [what, setWhat] = useState("");
  const [page, setPage] = useState(params.get("page") || "");
  const [message, setMessage] = useState(params.get("message") || "");
  const [phase, setPhase] = useState<"idle" | "saving" | "done">("idle");
  const [formError, setFormError] = useState("");
  const [sendError, setSendError] = useState("");

  return (
    <PageShell size="narrow" className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Aide"
        title="Aide"
        description="Les mots du logiciel, et un moyen de signaler ce qui bloque."
      />

      <SectionCard title="Glossaire">
        <dl className="space-y-3">
          {GLOSSARY_ENTRIES.map((entry) => (
            <div key={entry.term}>
              <dt className="text-sm font-bold text-slate-900 dark:text-slate-50">{entry.term}</dt>
              <dd className="text-sm text-slate-600 dark:text-slate-300">{entry.plain}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <SectionCard title="Signaler un problème">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = what.trim();
            if (text.length < 8) {
              setFormError("Décrivez en quelques mots ce que vous faisiez.");
              setSendError("");
              setPhase("idle");
              return;
            }
            setPhase("saving");
            setFormError("");
            setSendError("");
            void requestJson("/admin/support/bug", {
              method: "POST",
              headers: agentHeaders(),
              body: JSON.stringify({
                what: text,
                page: page.trim(),
                message: message.trim(),
              }),
              expectOk: false,
            })
              .then(({ res, data }) => {
                if (!res.ok) {
                  throw new Error(formatHttpApiErrorPayload(data) || "Envoi impossible.");
                }
                setPhase("done");
                setWhat("");
              })
              .catch((err: unknown) => {
                setPhase("idle");
                setSendError(err instanceof Error ? err.message : "Envoi impossible.");
              });
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Que faisiez-vous ?</span>
            <textarea
              className="input-field mt-1 min-h-24 w-full"
              value={what}
              onChange={(event) => setWhat(event.target.value)}
              maxLength={2000}
              required
              placeholder="J'ouvrais les tâches, puis l'écran est resté vide."
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Page</span>
            <input
              className="input-field mt-1 w-full"
              value={page}
              onChange={(event) => setPage(event.target.value)}
              maxLength={300}
              placeholder="/gestion/taches"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Message d&apos;erreur</span>
            <textarea
              className="input-field mt-1 min-h-20 w-full"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              placeholder="Chargement impossible."
            />
          </label>
          {formError ? <AlertBox tone="warn" title="À compléter">{formError}</AlertBox> : null}
          {sendError ? <AlertBox tone="error" title="Envoi impossible">{sendError}</AlertBox> : null}
          {phase === "done" ? (
            <AlertBox tone="success" title="Bien reçu">
              Le signalement est dans la cloche, en haut de l&apos;écran.
            </AlertBox>
          ) : null}
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={phase === "saving"}>
            {phase === "saving" ? "Envoi…" : "Envoyer"}
          </button>
        </form>
      </SectionCard>
    </PageShell>
  );
}

export default function AidePage() {
  return (
    <Suspense
      fallback={
        <PageShell size="narrow">
          <LoadingLine />
        </PageShell>
      }
    >
      <AideForm />
    </Suspense>
  );
}
