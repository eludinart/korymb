"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import AgentMessageMarkdown from "../../../components/AgentMessageMarkdown";
import {
  AlertBox,
  LoadingLine,
  PageHeader,
  PageShell,
  SectionCard,
} from "../../../components/ui/PageChrome";
import { businessApi, type KnowledgeDocument } from "../../../lib/business";

function DocCard({ doc }: { doc: KnowledgeDocument }) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {doc.category ? (
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {doc.category}
            </p>
          ) : null}
          <Link
            href={`/gestion/science/${doc.id}`}
            className="block text-sm font-extrabold text-slate-950 hover:underline dark:text-slate-50"
          >
            {doc.title}
          </Link>
          {doc.summary ? (
            <div className="mt-1 max-h-16 overflow-hidden text-xs text-slate-600 dark:text-slate-300">
              <AgentMessageMarkdown source={doc.summary} className="text-xs" />
            </div>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            {doc.tags?.length ? doc.tags.join(" · ") : "Sans tag"}
            {doc.author ? ` · ${doc.author}` : ""}
          </p>
        </div>
        <Link
          href={`/gestion/science/${doc.id}`}
          className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
        >
          Ouvrir
        </Link>
      </div>
    </li>
  );
}

function ScienceListInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const wantNew = params.get("nouveau") === "1";
  const projectId = (params.get("project") || "").trim();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [composer, setComposer] = useState(wantNew);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [docCategory, setDocCategory] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");

  const docs = useQuery({
    queryKey: ["knowledge-documents", q, category],
    queryFn: () =>
      businessApi.listKnowledgeDocuments({
        q: q.trim() || undefined,
        category: category.trim() || undefined,
      }),
  });

  const create = useMutation({
    mutationFn: () =>
      businessApi.createKnowledgeDocument({
        title: title.trim(),
        summary: summary.trim(),
        content_md: content.trim(),
        category: docCategory.trim(),
        project_id: projectId || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: async (doc) => {
      setTitle("");
      setSummary("");
      setContent("");
      setDocCategory("");
      setTags("");
      setComposer(false);
      setError("");
      await qc.invalidateQueries({ queryKey: ["knowledge-documents"] });
      window.location.href = `/gestion/science/${doc.id}`;
    },
    onError: (err: Error) => setError(err.message),
  });

  const byCategory = useMemo(() => {
    const map = new Map<string, KnowledgeDocument[]>();
    for (const doc of docs.data || []) {
      const key = doc.category?.trim() || "Sans catégorie";
      const list = map.get(key) || [];
      list.push(doc);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  }, [docs.data]);

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Science"
        title="Science de l'entreprise"
        description="Base documentaire métier — distincte du calendrier. Notes, stratégies, références."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/administration/contexte" className="btn-secondary text-xs">
              Questionnaire
            </Link>
            <button type="button" className="btn-primary" onClick={() => setComposer((v) => !v)}>
              {composer ? "Fermer" : "Ajouter un document"}
            </button>
          </div>
        }
      />

      {composer ? (
        <SectionCard title="Nouveau document">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim()) {
                setError("Le titre est obligatoire.");
                return;
              }
              create.mutate();
            }}
          >
            <input
              className="input-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titre"
              maxLength={400}
              aria-label="Titre du document"
            />
            <input
              className="input-field"
              value={docCategory}
              onChange={(e) => setDocCategory(e.target.value)}
              placeholder="Catégorie (ex. Stratégie)"
              maxLength={120}
            />
            <input
              className="input-field"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags, séparés par des virgules"
            />
            <textarea
              className="input-field min-h-16"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Résumé"
              maxLength={4000}
            />
            <textarea
              className="input-field min-h-40 font-mono text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Contenu markdown"
            />
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <button type="submit" className="btn-primary justify-self-start" disabled={create.isPending}>
              {create.isPending ? "Création…" : "Enregistrer"}
            </button>
          </form>
        </SectionCard>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          className="input-field max-w-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher…"
          aria-label="Rechercher dans la science"
        />
        <input
          className="input-field max-w-xs"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Filtrer catégorie"
          aria-label="Filtrer par catégorie"
        />
      </div>

      {docs.isLoading ? <LoadingLine /> : null}
      {docs.isError ? (
        <AlertBox tone="error" title="Erreur">
          Impossible de charger les documents.
        </AlertBox>
      ) : null}
      {!docs.isLoading && (docs.data || []).length === 0 ? (
        <p className="text-sm text-slate-500">Aucun document pour l’instant.</p>
      ) : null}

      <div className="grid gap-6">
        {byCategory.map(([cat, items]) => (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-extrabold text-slate-900 dark:text-slate-50">
              {cat}
              <span className="ml-1 font-normal text-slate-500">({items.length})</span>
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {items.map((doc) => (
                <DocCard key={doc.id} doc={doc} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

export default function ScienceListPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Chargement…</div>}>
      <ScienceListInner />
    </Suspense>
  );
}
