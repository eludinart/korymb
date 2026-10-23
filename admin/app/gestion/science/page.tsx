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
import {
  businessApi,
  type KnowledgeDocument,
  type ScienceEntityBrief,
  type ScienceOverview,
} from "../../../lib/business";

const FACT_LABELS: Record<string, string> = {
  brand: "Marque",
  tagline: "Formule",
  location: "Lieu",
  offers: "Offres",
  activity: "Activité",
  tone: "Ton",
  icp: "Public",
};

const SUGGESTED_CATEGORIES = ["Stratégie", "Offre", "Process", "Référence", "Note", "Calendrier"];

function formatFactValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(" · ");
  return String(value || "").trim();
}

function EntityChip({ entity }: { entity: ScienceEntityBrief }) {
  const attrs = Object.entries(entity.attributes || {}).slice(0, 3);
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        {entity.entity_type || "fiche"}
      </p>
      <p className="text-sm font-extrabold text-slate-950 dark:text-slate-50">{entity.name}</p>
      {attrs.length ? (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
          {attrs.map(([k, v]) => (
            <li key={k}>
              <span className="font-semibold text-slate-700 dark:text-slate-200">{k}</span>
              {v ? ` · ${v}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

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

function EnrichBanner({ overview }: { overview: ScienceOverview }) {
  const offers = overview.context_guide?.offers || [];
  const mode = overview.context_guide?.offers_mode;
  const questionnaire = overview.links?.questionnaire || "/administration/contexte";
  if (!offers.length) {
    return (
      <SectionCard
        title="Pour enrichir la science"
        description="L’IA propose des questions quand un trou utile apparaît — sans redemander ce qui est déjà connu."
        action={
          <Link href={questionnaire} className="btn-secondary text-xs">
            Ouvrir le questionnaire
          </Link>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Aucune question en attente pour l’instant. Vous pouvez quand même ajouter un détail via le
          questionnaire, ou laisser l’usage (missions, échanges) nourrir la science.
        </p>
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title={mode === "gaps" ? "Pour enrichir la science" : "Pour démarrer la science"}
      description={
        mode === "gaps"
          ? "Quelques précisions utiles à partir de ce qui est déjà écrit."
          : "Standards pour amorcer le contexte — masquables dans le questionnaire."
      }
      action={
        <Link href={questionnaire} className="btn-primary text-xs">
          Répondre au questionnaire
        </Link>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-1">
        {offers.slice(0, 3).map((offer) => (
          <li
            key={offer.id}
            className="rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2 dark:border-violet-800 dark:bg-violet-950/40"
          >
            <p className="text-sm font-bold text-violet-950 dark:text-violet-100">
              {offer.title || offer.question || "Question"}
            </p>
            {offer.hint || offer.question ? (
              <p className="mt-0.5 text-xs text-violet-900/80 dark:text-violet-200/80">
                {offer.hint || offer.question}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function ScienceListInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const wantNew = params.get("nouveau") === "1";
  const projectFromUrl = (params.get("project") || "").trim();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [composer, setComposer] = useState(wantNew);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [docCategory, setDocCategory] = useState("");
  const [tags, setTags] = useState("");
  const [projectId, setProjectId] = useState(projectFromUrl);
  const [error, setError] = useState("");
  const [migrateMsg, setMigrateMsg] = useState("");

  const overview = useQuery({
    queryKey: ["science-overview"],
    queryFn: () => businessApi.getScienceOverview(),
  });

  const projects = useQuery({
    queryKey: ["projects", "science-composer"],
    queryFn: () => businessApi.listProjects(),
    enabled: composer,
  });

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
      await qc.invalidateQueries({ queryKey: ["science-overview"] });
      window.location.href = `/gestion/science/${doc.id}`;
    },
    onError: (err: Error) => setError(err.message),
  });

  const migrate = useMutation({
    mutationFn: () => businessApi.migrateKnowledgeFromCalendar(false),
    onSuccess: async (result) => {
      const n = result.created ?? 0;
      setMigrateMsg(
        n > 0
          ? `${n} document${n > 1 ? "s" : ""} importé${n > 1 ? "s" : ""} depuis le calendrier.`
          : "Rien à importer — déjà à jour.",
      );
      await qc.invalidateQueries({ queryKey: ["knowledge-documents"] });
      await qc.invalidateQueries({ queryKey: ["science-overview"] });
    },
    onError: (err: Error) => setMigrateMsg(err.message),
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

  const ov = overview.data;
  const factEntries = Object.entries(ov?.facts || {}).filter(([k]) => k !== "updated_at");
  const memoryHref = ov?.links?.memory || "/administration/memory";
  const questionnaireHref = ov?.links?.questionnaire || "/administration/contexte";
  const pendingCal = ov?.calendar_migrate?.pending_count ?? 0;
  // Jamais le teaser clipé (global_preview) quand le MD complet existe ou quand has_more.
  const contextMd = (ov?.global_md || "").trim();
  const previewText = (ov?.global_preview?.text || "").trim();
  const previewIsTeaser = Boolean(ov?.global_preview?.has_more);
  const contextSource = contextMd || (previewIsTeaser ? "" : previewText);

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Science"
        title="Science de l'entreprise"
        description="Identité, personnes, contexte confirmé, fiches et documents — nourris par l’usage et le questionnaire."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={questionnaireHref} className="btn-secondary text-xs">
              Questionnaire
            </Link>
            <Link href={memoryHref} className="btn-secondary text-xs">
              Mémoire
            </Link>
            <button type="button" className="btn-primary" onClick={() => setComposer((v) => !v)}>
              {composer ? "Fermer" : "Ajouter un document"}
            </button>
          </div>
        }
      />

      {overview.isLoading ? <LoadingLine /> : null}
      {overview.isError ? (
        <AlertBox tone="error" title="Erreur">
          Impossible de charger l’aperçu Science.
        </AlertBox>
      ) : null}

      {ov ? <EnrichBanner overview={ov} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Identité"
          description="Faits structurés de l’entreprise"
          action={
            <Link href={memoryHref} className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200">
              Enrichir
            </Link>
          }
        >
          {factEntries.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucun fait encore.{" "}
              <Link href={questionnaireHref} className="font-semibold text-violet-700 underline dark:text-violet-300">
                Répondre au questionnaire
              </Link>{" "}
              ou laisser l’usage remplir.
            </p>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2">
              {factEntries.map(([key, value]) => {
                const label = FACT_LABELS[key] || key;
                const text = formatFactValue(value);
                if (!text) return null;
                return (
                  <div key={key} className="rounded-xl border border-slate-100 px-3 py-2 dark:border-slate-800">
                    <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-50">{text}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </SectionCard>

        <SectionCard
          title="Dirigeant"
          description="Personnes liées à l’activité"
          action={
            <Link href={questionnaireHref} className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200">
              Préciser
            </Link>
          }
        >
          {(ov?.persons || []).length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucune fiche personne. Le questionnaire peut en proposer une quand c’est utile.
            </p>
          ) : (
            <ul className="grid gap-2">
              {(ov?.persons || []).map((p) => (
                <EntityChip key={String(p.entity_id || p.name)} entity={p} />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Contexte confirmé"
        description="Mémoire globale — édition dans Mémoire / questionnaire"
        action={
          <Link href={memoryHref} className="btn-secondary text-xs">
            Ouvrir la mémoire
          </Link>
        }
      >
        {contextSource ? (
          <div className="max-h-[min(70vh,36rem)] overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/40 sm:px-4">
            <AgentMessageMarkdown
              source={contextSource}
              className="text-sm leading-relaxed text-slate-800 dark:text-slate-100"
            />
          </div>
        ) : previewIsTeaser && previewText ? (
          <div className="space-y-2">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              L’API n’a renvoyé que l’extrait tronqué — ouvrez la mémoire pour le texte complet
              ({ov?.global_preview?.chars ?? "?"} caractères).
            </p>
            <Link href={memoryHref} className="btn-secondary text-xs">
              Ouvrir la mémoire (texte complet)
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Pas encore de contexte global confirmé.{" "}
            <Link href={questionnaireHref} className="font-semibold text-violet-700 underline dark:text-violet-300">
              Commencer le questionnaire
            </Link>
            .
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Fiches"
        description="Projets, activités et autres entités"
        action={
          <Link href={questionnaireHref} className="text-xs font-bold text-violet-800 hover:underline dark:text-violet-200">
            Enrichir via le guide
          </Link>
        }
      >
        {(ov?.entities || []).length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucune fiche pour l’instant. Elles apparaissent au fil des réponses confirmées et des missions.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(ov?.entities || []).map((e) => (
              <EntityChip key={String(e.entity_id || e.name)} entity={e} />
            ))}
          </ul>
        )}
      </SectionCard>

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
            <div className="flex flex-wrap gap-2">
              <input
                className="input-field max-w-xs"
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value)}
                placeholder="Catégorie"
                maxLength={120}
                list="science-doc-categories"
                aria-label="Catégorie"
              />
              <datalist id="science-doc-categories">
                {SUGGESTED_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <select
                className="input-field max-w-xs"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label="Projet lié"
              >
                <option value="">Sans projet</option>
                {(projects.data || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${
                    docCategory === c
                      ? "border-violet-400 bg-violet-50 text-violet-900 dark:border-violet-600 dark:bg-violet-950 dark:text-violet-100"
                      : "border-slate-200 text-slate-600 hover:border-violet-300 dark:border-slate-700 dark:text-slate-300"
                  }`}
                  onClick={() => setDocCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
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

      <SectionCard
        title="Documents"
        description="Notes, PDF, stratégies — distincts du calendrier"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {pendingCal > 0 ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={migrate.isPending}
                onClick={() => {
                  setMigrateMsg("");
                  migrate.mutate();
                }}
              >
                {migrate.isPending
                  ? "Import…"
                  : `Importer ${pendingCal} du calendrier`}
              </button>
            ) : null}
            <button type="button" className="btn-primary text-xs" onClick={() => setComposer(true)}>
              Ajouter
            </button>
          </div>
        }
      >
        {migrateMsg ? (
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{migrateMsg}</p>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-2">
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
          <div className="space-y-2 text-sm text-slate-500">
            <p>
              Aucun document pour l’instant — la science utile est surtout dans l’identité, le contexte et
              les fiches ci-dessus.
            </p>
            {pendingCal > 0 ? (
              <p>
                {pendingCal} fichier{pendingCal > 1 ? "s" : ""} du calendrier peu{pendingCal > 1 ? "vent" : "t"}{" "}
                être importé{pendingCal > 1 ? "s" : ""} ici.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-6">
          {byCategory.map(([cat, items]) => (
            <section key={cat}>
              <h3 className="mb-2 text-sm font-extrabold text-slate-900 dark:text-slate-50">
                {cat}
                <span className="ml-1 font-normal text-slate-500">({items.length})</span>
              </h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {items.map((doc) => (
                  <DocCard key={doc.id} doc={doc} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SectionCard>
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
