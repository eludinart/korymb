"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AgentMessageMarkdown from "../../../../components/AgentMessageMarkdown";
import {
  AlertBox,
  LoadingLine,
  PageHeader,
  PageShell,
  SectionCard,
} from "../../../../components/ui/PageChrome";
import { businessApi } from "../../../../lib/business";
import { apiUrl } from "../../../../lib/api";

export default function ScienceDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const doc = useQuery({
    queryKey: ["knowledge-document", id],
    queryFn: () => businessApi.getKnowledgeDocument(id),
    enabled: Boolean(id),
  });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!doc.data) return;
    setTitle(doc.data.title || "");
    setSummary(doc.data.summary || "");
    setContent(doc.data.content_md || "");
    setCategory(doc.data.category || "");
    setTags((doc.data.tags || []).join(", "));
  }, [doc.data]);

  const save = useMutation({
    mutationFn: () =>
      businessApi.updateKnowledgeDocument(id, {
        title: title.trim(),
        summary: summary.trim(),
        content_md: content.trim(),
        category: category.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      setEditing(false);
      setError("");
      await qc.invalidateQueries({ queryKey: ["knowledge-document", id] });
      await qc.invalidateQueries({ queryKey: ["knowledge-documents"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const archive = useMutation({
    mutationFn: () => businessApi.archiveKnowledgeDocument(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["knowledge-documents"] });
      router.push("/gestion/science");
    },
    onError: (err: Error) => setError(err.message),
  });

  if (doc.isLoading) {
    return (
      <PageShell>
        <LoadingLine />
      </PageShell>
    );
  }
  if (doc.isError || !doc.data) {
    return (
      <PageShell>
        <AlertBox tone="error" title="Introuvable">
          Ce document n’existe pas ou a été archivé.
        </AlertBox>
        <Link href="/gestion/science" className="btn-secondary mt-4 inline-flex">
          Retour
        </Link>
      </PageShell>
    );
  }

  const row = doc.data;

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="violet"
        badge={row.category || "Science"}
        title={row.title}
        description={row.summary || "Document de la science de l'entreprise."}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/gestion/science" className="btn-secondary text-xs">
              Liste
            </Link>
            <button type="button" className="btn-secondary text-xs" onClick={() => setEditing((v) => !v)}>
              {editing ? "Annuler" : "Modifier"}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs text-red-800"
              disabled={archive.isPending}
              onClick={() => {
                if (!window.confirm("Archiver ce document ? Il quitte l’index Classique.")) return;
                archive.mutate();
              }}
            >
              Archiver
            </button>
          </div>
        }
      />

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {editing ? (
        <SectionCard title="Édition">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={400} />
            <input className="input-field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Catégorie" />
            <input className="input-field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags" />
            <textarea className="input-field min-h-16" value={summary} onChange={(e) => setSummary(e.target.value)} />
            <textarea
              className="input-field min-h-56 font-mono text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <button type="submit" className="btn-primary justify-self-start" disabled={save.isPending}>
              {save.isPending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </form>
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Contenu">
            {row.tags?.length ? (
              <p className="mb-3 text-xs font-semibold text-slate-500">{row.tags.join(" · ")}</p>
            ) : null}
            <AgentMessageMarkdown source={row.content_md || row.summary || "_Document vide._"} />
          </SectionCard>
          {row.resource_file_id ? (
            <SectionCard title="Fichier joint">
              <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
                Pièce jointe liée (aperçu inline si le navigateur le permet).
              </p>
              <iframe
                title={`Aperçu ${row.title}`}
                className="h-[70vh] w-full rounded-xl border border-slate-200 dark:border-slate-700"
                src={apiUrl(`/business/resource-files/${encodeURIComponent(row.resource_file_id)}/preview`)}
              />
            </SectionCard>
          ) : null}
          {row.project_id ? (
            <p className="text-sm">
              Projet lié :{" "}
              <Link href={`/gestion/projets/${row.project_id}`} className="font-semibold text-violet-800 underline">
                ouvrir
              </Link>
            </p>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
