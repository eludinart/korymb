"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertBox, LoadingLine, PageHeader, PageShell, SectionCard } from "../../../../components/ui/PageChrome";
import { businessApi, type BizContact, type BizExternalInvoice, type BizProject, type QuoteLine } from "../../../../lib/business";
import { INVOICE_STATUS_LABELS, QUOTE_STATUS_LABELS, formatEuroCents } from "../../_shared";

const emptyLine = (): QuoteLine => ({ label: "", qty: 1, unit_price_cents: 0, tax_rate: 0 });

function InvoiceEditRow({
  invoice,
  quoteId,
  onSaved,
}: {
  invoice: BizExternalInvoice;
  quoteId: string;
  onSaved: () => void;
}) {
  const [tiimeId, setTiimeId] = useState(invoice.tiime_invoice_id || "");
  const [tiimeStatus, setTiimeStatus] = useState(invoice.tiime_status || "issued");
  const [externalUrl, setExternalUrl] = useState(invoice.external_url || "");
  const [amountEur, setAmountEur] = useState(invoice.amount_cents ? String(invoice.amount_cents / 100) : "");
  const [msg, setMsg] = useState("");

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateExternalInvoice(invoice.id, {
        tiime_invoice_id: tiimeId.trim(),
        tiime_status: tiimeStatus,
        external_url: externalUrl.trim(),
        amount_cents: Math.round(parseFloat(amountEur || "0") * 100),
        paid_at: tiimeStatus === "paid" && !invoice.paid_at ? new Date().toISOString() : undefined,
      }),
    onSuccess: () => {
      setMsg("Facture mise à jour.");
      onSaved();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Facture Tiime · {invoice.id.slice(0, 8)}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">N° facture Tiime</span>
          <input className="input-field mt-1 w-full" value={tiimeId} onChange={(e) => setTiimeId(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Statut</span>
          <select className="input-field mt-1 w-full" value={tiimeStatus} onChange={(e) => setTiimeStatus(e.target.value)}>
            {Object.entries(INVOICE_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">Montant € TTC</span>
          <input type="number" min={0} step={0.01} className="input-field mt-1 w-full" value={amountEur} onChange={(e) => setAmountEur(e.target.value)} />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium">URL Tiime</span>
          <input className="input-field mt-1 w-full" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
        </label>
      </div>
      <button type="button" className="btn-secondary text-xs" disabled={save.isPending || !tiimeId.trim()} onClick={() => save.mutate()}>
        {save.isPending ? "Enregistrement…" : "Mettre à jour la facture"}
      </button>
      {msg ? <p className="text-xs text-slate-600">{msg}</p> : null}
      <input type="hidden" value={quoteId} readOnly />
    </div>
  );
}

export default function GestionDevisEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState("draft");
  const [lines, setLines] = useState<QuoteLine[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [tiimeMsg, setTiimeMsg] = useState("");
  const [newTiimeId, setNewTiimeId] = useState("");
  const [newTiimeUrl, setNewTiimeUrl] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const quote = useQuery({
    queryKey: ["business-quote", id],
    queryFn: () => businessApi.getQuote(id),
    enabled: Boolean(id),
  });
  const contacts = useQuery({ queryKey: ["business-contacts"], queryFn: () => businessApi.listContacts() });
  const projects = useQuery({ queryKey: ["business-projects"], queryFn: () => businessApi.listProjects() });

  useEffect(() => {
    if (!quote.data || hydrated) return;
    const q = quote.data;
    setTitle(q.title || "");
    setContactId(q.contact_id || "");
    setProjectId(q.project_id || "");
    setStatus(q.status || "draft");
    setLines(q.lines?.length ? q.lines : [emptyLine()]);
    setNotes(q.notes || "");
    setHydrated(true);
  }, [quote.data, hydrated]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["business-quotes"] });
    void qc.invalidateQueries({ queryKey: ["business-quote", id] });
    void qc.invalidateQueries({ queryKey: ["business-overview"] });
  };

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateQuote(id, {
        title: title.trim(),
        contact_id: contactId || null,
        project_id: projectId || null,
        status,
        lines: lines.filter((l) => l.label.trim()),
        notes: notes.trim(),
      }),
    onSuccess: () => {
      invalidate();
      router.push("/gestion/devis");
    },
    onError: (e: Error) => setError(e.message),
  });

  const tiimeRequest = useMutation({
    mutationFn: () => businessApi.requestTiimeInvoice(id),
    onSuccess: (data) => {
      setTiimeMsg(data.message);
      if (data.tiime_app_url) window.open(data.tiime_app_url, "_blank", "noopener,noreferrer");
      invalidate();
    },
    onError: (e: Error) => setTiimeMsg(e.message),
  });

  const recordInvoice = useMutation({
    mutationFn: () =>
      businessApi.recordTiimeInvoice({
        quote_id: id,
        tiime_invoice_id: newTiimeId.trim(),
        external_url: newTiimeUrl.trim(),
        tiime_status: "issued",
      }),
    onSuccess: () => {
      setNewTiimeId("");
      setNewTiimeUrl("");
      setTiimeMsg("Référence facture Tiime enregistrée.");
      invalidate();
    },
    onError: (e: Error) => setTiimeMsg(e.message),
  });

  if (quote.isLoading) {
    return (
      <PageShell size="wide">
        <LoadingLine label="Chargement du devis…" />
      </PageShell>
    );
  }

  if (quote.isError || !quote.data) {
    return (
      <PageShell size="wide">
        <AlertBox tone="error" title="Devis introuvable">
          <Link href="/gestion/devis" className="underline">
            Retour à la liste
          </Link>
        </AlertBox>
      </PageShell>
    );
  }

  const invoices = quote.data.external_invoices || [];

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Devis"
        title={`${quote.data.quote_number} — ${quote.data.title}`}
        description={`Total actuel : ${formatEuroCents(quote.data.total_cents)}`}
        actions={
          <Link href="/gestion/devis" className="btn-link-secondary">
            ← Retour à la liste
          </Link>
        }
      />

      {tiimeMsg ? (
        <AlertBox tone="info" title="Tiime">
          {tiimeMsg}
        </AlertBox>
      ) : null}

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
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Intitulé *</span>
              <input className="input-field mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Statut</span>
              <select className="input-field mt-1 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(QUOTE_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
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
            <label className="block text-sm sm:col-span-2">
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
                  <button type="button" className="text-xs text-red-700 sm:col-span-1" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
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
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer le devis"}
            </button>
            <Link href="/gestion/devis" className="btn-secondary">
              Annuler
            </Link>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Facturation Tiime">
        <p className="mb-3 text-sm text-slate-600">
          La facture légale est émise dans Tiime. Enregistrez ici la référence pour le suivi dans Korymb.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          <button type="button" className="btn-primary text-sm" disabled={tiimeRequest.isPending} onClick={() => tiimeRequest.mutate()}>
            Demander facture Tiime
          </button>
          <a href="https://app.tiime.fr/" target="_blank" rel="noreferrer" className="btn-secondary text-sm">
            Ouvrir Tiime
          </a>
        </div>

        {invoices.length > 0 ? (
          <div className="space-y-3 mb-4">
            {invoices.map((inv) => (
              <InvoiceEditRow key={inv.id} invoice={inv} quoteId={id} onSaved={invalidate} />
            ))}
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-500">Aucune facture Tiime liée pour l&apos;instant.</p>
        )}

        <div className="border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-700 mb-2">Ajouter une référence facture</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">N° facture Tiime</span>
              <input className="input-field mt-1 w-full" value={newTiimeId} onChange={(e) => setNewTiimeId(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-medium">URL (optionnel)</span>
              <input className="input-field mt-1 w-full" value={newTiimeUrl} onChange={(e) => setNewTiimeUrl(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="btn-secondary mt-3 text-sm"
            disabled={recordInvoice.isPending || !newTiimeId.trim()}
            onClick={() => recordInvoice.mutate()}
          >
            Enregistrer la référence
          </button>
        </div>
      </SectionCard>
    </PageShell>
  );
}
