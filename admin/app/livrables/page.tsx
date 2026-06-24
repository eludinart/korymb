"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertBox,
  LoadingLine,
  PageHeader,
  PageLink,
  PageShell,
  SectionCard,
} from "../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../lib/api";
import {
  deliverableChannelMeta,
  livrableAnchorId,
  type DeliverableChannel,
} from "../../lib/deliverableAssets";
import { QK } from "../../lib/queryClient";

type LibraryItem = {
  id: string;
  title: string;
  channel: DeliverableChannel;
  href?: string;
  agent?: string;
  job_id: string;
  mission?: string;
  source?: string;
  theme?: string;
  created_at?: string;
  job_href?: string;
  markdown_preview?: string;
};

type LibraryTheme = {
  theme: string;
  count: number;
  items: LibraryItem[];
};

const THEME_STYLES: Record<string, string> = {
  "Prospection & vente": "border-sky-200 bg-sky-50/80",
  Communication: "border-violet-200 bg-violet-50/80",
  "Courriers & emails": "border-amber-200 bg-amber-50/80",
  "Veille & marché": "border-teal-200 bg-teal-50/80",
  "Stratégie & pilotage": "border-indigo-200 bg-indigo-50/80",
  "Finance & admin": "border-slate-200 bg-slate-50/80",
  "Autres livrables": "border-emerald-200 bg-emerald-50/80",
};

function sourceLabel(source?: string) {
  const s = String(source || "").toLowerCase();
  if (s === "chat") return "Chat";
  if (s === "scheduler" || s === "autonomous") return "Autonomie";
  return "Mission";
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function DeliverableCard({ item }: { item: LibraryItem }) {
  const meta = deliverableChannelMeta(item.channel);
  const isDrive = item.channel.startsWith("drive_");
  const inAppHref =
    item.channel === "in_app" && item.job_href
      ? `${item.job_href}#${livrableAnchorId(item.title)}`
      : null;

  return (
    <article className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
            {meta.label}
          </span>
          <span className="text-[10px] font-medium text-slate-500">{sourceLabel(item.source)}</span>
          {item.created_at ? (
            <span className="text-[10px] text-slate-400">{fmtDate(item.created_at)}</span>
          ) : null}
        </div>
        <h3 className="text-sm font-semibold leading-snug text-slate-900">{item.title}</h3>
        {item.mission ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-slate-600" title={item.mission}>
            {item.mission}
          </p>
        ) : null}
        {item.agent ? <p className="text-[10px] text-slate-500">Agent : {item.agent}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {isDrive && item.href ? (
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded-lg border px-3 py-2 text-xs font-bold ${meta.style}`}
          >
            {meta.actionLabel}
          </a>
        ) : null}
        {inAppHref ? (
          <Link href={inAppHref} className={`rounded-lg border px-3 py-2 text-xs font-bold ${meta.style}`}>
            {meta.actionLabel}
          </Link>
        ) : null}
        {item.job_href ? (
          <Link
            href={item.job_href}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Voir le contexte
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function LivrablesContent() {
  const searchParams = useSearchParams();
  const filterJob = (searchParams.get("job") || "").trim();

  const library = useQuery({
    queryKey: [...QK.deliverablesLibrary, filterJob || "all"],
    queryFn: async () => {
      const { data } = await requestJson(
        "/deliverables/library?limit=250",
        { headers: agentHeaders(), retries: 1, timeoutMs: 30_000 },
      );
      return data as { total?: number; themes?: LibraryTheme[] };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const themes = useMemo(() => {
    const raw = library.data?.themes || [];
    if (!filterJob) return raw;
    return raw
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => i.job_id === filterJob),
        count: g.items.filter((i) => i.job_id === filterJob).length,
      }))
      .filter((g) => g.count > 0);
  }, [library.data, filterJob]);

  const total = themes.reduce((n, g) => n + g.count, 0);

  return (
    <PageShell size="wide">
      <PageHeader
        accent="emerald"
        badge="Bibliothèque"
        title="Livrables générés"
        description="Tous les fichiers Drive et pièces opérationnelles produits par Korymb, classés par thématique."
        actions={
          <>
            <PageLink href="/chat">Chat</PageLink>
            <PageLink href="/missions" variant="secondary">
              Missions
            </PageLink>
          </>
        }
      />

      {filterJob ? (
        <AlertBox tone="info" title={`Filtre actif — job #${filterJob}`}>
          <Link href="/livrables" className="font-semibold text-violet-800 hover:underline">
            Afficher toute la bibliothèque
          </Link>
        </AlertBox>
      ) : null}

      {library.isLoading ? <LoadingLine /> : null}
      {library.isError ? (
        <AlertBox tone="error" title="Bibliothèque indisponible">
          Vérifiez que le backend est démarré (redémarrage requis après mise à jour), puis rechargez.
        </AlertBox>
      ) : null}

      {library.data && total === 0 ? (
        <SectionCard title="Aucun livrable pour l'instant">
          <p className="text-sm leading-relaxed text-slate-600">
            Lancez une mission ou une demande chat qui produit un tableau, un courrier ou un document. Les liens Drive
            apparaîtront ici automatiquement dès l&apos;export.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/chat" className="btn-primary text-sm">
              Ouvrir le chat
            </Link>
            <Link href="/missions" className="btn-secondary text-sm">
              Hub missions
            </Link>
          </div>
        </SectionCard>
      ) : null}

      <div className="space-y-8">
        {themes.map((group) => (
          <section
            key={group.theme}
            className={`rounded-2xl border-2 p-4 sm:p-5 ${THEME_STYLES[group.theme] || THEME_STYLES["Autres livrables"]}`}
          >
            <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight text-slate-900">{group.theme}</h2>
                <p className="text-xs text-slate-600">
                  {group.count} livrable{group.count > 1 ? "s" : ""} — accès direct en un clic
                </p>
              </div>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => (
                <DeliverableCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

export default function LivrablesPage() {
  return (
    <Suspense fallback={<PageShell size="wide"><LoadingLine /></PageShell>}>
      <LivrablesContent />
    </Suspense>
  );
}
