"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi, type BizContact, type BizProject, type QuoteLine } from "../../../../lib/business";

const emptyLine = (): QuoteLine => ({ label: "", qty: 1, unit_price_cents: 0, tax_rate: 0 });

export default function GestionDevisNouveauPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [lines, setLines] = useState<QuoteLine[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });

  const create = useMutation({
    mutationFn: () =>
      businessApi.createQuote({
        title: title.trim(),
        contact_id: contactId || null,
        project_id: projectId || null,
        lines: lines.filter((l) => l.label.trim()),
        notes: notes.trim(),
        status: "draft",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["business-quotes"] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      router.push("/gestion/devis");
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Devis"
        title="Nouveau devis"
        description="Devis commercial dans Korymb — facture légale via Tiime ensuite."
        actions={
          <Link href="/gestion/devis" className="btn-link-secondary">
            ← Retour à la liste
          </Link>
        }
      />

      <SectionCard title="Devis">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) {
              setError("Le titre est obligatoire.");
              return;
            }
            if (!lines.some((l) => l.label.trim())) {
              setError("Ajoutez au moins une ligne.");
              return;
            }
            create.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Intitulé *</span>
              <input className="input-field mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Contact</span>
              <select className="input-field mt-1 w-full" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">— Aucun —</option>
                {(contacts.data || []).map((c: BizContact) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Projet</span>
              <select className="input-field mt-1 w-full" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">— Aucun —</option>
                {(projects.data || []).map((p: BizProject) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">Lignes</p>
            <div className="mt-2 space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid gap-2 sm:grid-cols-12">
                  <input
                    className="input-field sm:col-span-5"
                    placeholder="Prestation"
                    value={line.label}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...line, label: e.target.value };
                      setLines(next);
                    }}
                  />
                  <input
                    type="number"
                    min={0.01}
                    step={0.5}
                    className="input-field sm:col-span-2"
                    placeholder="Qté"
                    value={line.qty}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...line, qty: parseFloat(e.target.value) || 1 };
                      setLines(next);
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    className="input-field sm:col-span-2"
                    placeholder="Prix € HT"
                    value={line.unit_price_cents ? line.unit_price_cents / 100 : ""}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...line, unit_price_cents: Math.round(parseFloat(e.target.value || "0") * 100) };
                      setLines(next);
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field sm:col-span-2"
                    placeholder="TVA %"
                    value={line.tax_rate || ""}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...line, tax_rate: parseFloat(e.target.value || "0") };
                      setLines(next);
                    }}
                  />
                  <button
                    type="button"
                    className="text-xs text-red-700 sm:col-span-1"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="mt-2 text-sm font-medium text-emerald-800 hover:underline" onClick={() => setLines([...lines, emptyLine()])}>
              + Ligne
            </button>
          </div>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea className="input-field mt-1 w-full" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? "Création…" : "Créer le devis"}
            </button>
            <Link href="/gestion/devis" className="btn-secondary">
              Annuler
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </SectionCard>
    </PageShell>
  );
}
