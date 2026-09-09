"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

type LibrarySource = {
  job_id: string;
  mission?: string;
  created_at?: string;
  job_href?: string;
  source?: string;
  agent?: string;
};

type LibraryAccessPoint = {
  channel: DeliverableChannel;
  href?: string;
  job_href?: string;
  anchor?: string;
  label?: string;
};

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
  description?: string;
  content_hint?: string;
  source_count?: number;
  sources?: LibrarySource[];
  access_points?: LibraryAccessPoint[];
  member_ids?: string[];
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

function accessPointHref(point: LibraryAccessPoint, item: LibraryItem) {
  if (point.channel === "in_app" && point.job_href) {
    const anchor = point.anchor || livrableAnchorId(point.label || item.title);
    return `${point.job_href}#${anchor}`;
  }
  return point.href || point.job_href || item.href || item.job_href || "#";
}

function cardActionButtons(item: LibraryItem): LibraryAccessPoint[] {
  if (item.access_points?.length) {
    return item.access_points;
  }
  if (item.href) {
    return [{ channel: item.channel, href: item.href, label: item.title }];
  }
  if (item.channel === "in_app" && item.job_href) {
    return [{ channel: "in_app", job_href: item.job_href, label: item.title }];
  }
  return [];
}

function DeliverableCard({
  item,
  onDismiss,
  dismissBusy,
}: {
  item: LibraryItem;
  onDismiss: (item: LibraryItem) => void;
  dismissBusy: boolean;
}) {
  const meta = deliverableChannelMeta(item.channel);
  const points = cardActionButtons(item);
  const showContextLink =
    Boolean(item.job_href) &&
    !points.some(
      (p) =>
        p.channel === "in_app" &&
        p.job_href === item.job_href &&
        !p.anchor,
    );

  const description =
    item.description ||
    item.markdown_preview ||
    item.mission ||
    "Livrable produit par Korymb — ouvrez-le pour consulter le détail.";

  return (
    <article className="relative flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={() => onDismiss(item)}
        disabled={dismissBusy}
        className="absolute right-2 top-2 z-10 touch-target flex items-center justify-center rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-500 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
        aria-label={`Retirer ${item.title} de la bibliothèque`}
        title="Retirer de la bibliothèque"
      >
        ×
      </button>
      <div className="min-w-0 space-y-2 pr-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
            {meta.label}
          </span>
          {item.content_hint ? (
            <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800">
              {item.content_hint}
            </span>
          ) : null}
          <span className="text-[10px] font-medium text-slate-500">{sourceLabel(item.source)}</span>
          {item.source_count && item.source_count > 1 ? (
            <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold text-violet-800">
              {item.source_count} missions
            </span>
          ) : null}
          {item.created_at ? (
            <span className="text-[10px] text-slate-400">{fmtDate(item.created_at)}</span>
          ) : null}
        </div>
        <h3 className="text-sm font-semibold leading-snug text-slate-900">{item.title}</h3>
        <p className="line-clamp-4 text-xs leading-relaxed text-slate-700" title={description}>
          {description}
        </p>
        {item.mission && item.mission !== description ? (
          <p className="line-clamp-1 text-[10px] text-slate-500" title={item.mission}>
            Mission : {item.mission}
          </p>
        ) : null}
        {item.agent ? <p className="text-[10px] text-slate-500">Agent : {item.agent}</p> : null}
        {item.sources && item.sources.length > 1 ? (
          <details className="text-[10px] text-slate-600">
            <summary className="cursor-pointer font-semibold text-violet-800">
              Voir les {item.sources.length} origines
            </summary>
            <ul className="mt-1 space-y-1 pl-1">
              {item.sources.map((s) => (
                <li key={s.job_id}>
                  {s.job_href ? (
                    <Link href={s.job_href} className="text-violet-800 hover:underline">
                      #{s.job_id}
                    </Link>
                  ) : (
                    <span>#{s.job_id}</span>
                  )}
                  {s.mission ? <span className="text-slate-500"> — {s.mission.slice(0, 80)}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {points.map((point, idx) => {
          const pMeta = deliverableChannelMeta(point.channel);
          const href = accessPointHref(point, item);
          const isExternal = point.channel.startsWith("drive_") && Boolean(point.href);

          if (isExternal) {
            return (
              <a
                key={`${point.channel}:${point.href}:${idx}`}
                href={point.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`rounded-lg border px-3 py-2 text-xs font-bold ${pMeta.style}`}
              >
                {pMeta.actionLabel}
              </a>
            );
          }
          return (
            <Link
              key={`${point.channel}:${href}:${idx}`}
              href={href}
              className={`rounded-lg border px-3 py-2 text-xs font-bold ${pMeta.style}`}
            >
              {pMeta.actionLabel}
            </Link>
          );
        })}
        {showContextLink && item.job_href ? (
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
  const qc = useQueryClient();
  const [dismissFeedback, setDismissFeedback] = useState("");
  const [dismissError, setDismissError] = useState("");

  const library = useQuery({
    queryKey: [...QK.deliverablesLibrary, filterJob || "all"],
    queryFn: async () => {
      const { data } = await requestJson(
        "/deliverables/library?limit=250",
        { headers: agentHeaders(), retries: 1, timeoutMs: 30_000 },
      );
      return data as { total?: number; raw_total?: number; themes?: LibraryTheme[] };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const dismissMut = useMutation({
    mutationFn: async (itemId: string) => {
      const { res, data } = await requestJson("/deliverables/library/dismiss", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) {
        const detail = (data as { detail?: string })?.detail;
        throw new Error(detail || "Impossible de retirer ce livrable.");
      }
      return data as { dismissed_ids?: string[]; item_id?: string };
    },
    onMutate: async (itemId) => {
      setDismissFeedback("");
      setDismissError("");
      const queryKey = [...QK.deliverablesLibrary, filterJob || "all"];
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<{ total?: number; themes?: LibraryTheme[] }>(queryKey);
      if (previous?.themes) {
        const themes = previous.themes
          .map((g) => {
            const items = g.items.filter((i) => i.id !== itemId);
            return { ...g, items, count: items.length };
          })
          .filter((g) => g.count > 0);
        const total = themes.reduce((n, g) => n + g.count, 0);
        qc.setQueryData(queryKey, { ...previous, themes, total });
      }
      return { previous, queryKey };
    },
    onSuccess: () => {
      setDismissError("");
      setDismissFeedback("Livrable retiré de la bibliothèque.");
      void qc.invalidateQueries({ queryKey: QK.deliverablesLibrary });
    },
    onError: (err: Error, _itemId, context) => {
      setDismissFeedback("");
      const msg = err.message || "Erreur lors de la suppression.";
      setDismissError(
        msg.includes("Not Found") || msg.includes("404")
          ? "Action indisponible : redémarrez le backend (.\\start-dev-cursor.ps1) puis réessayez."
          : msg,
      );
      if (context?.previous && context.queryKey) {
        qc.setQueryData(context.queryKey, context.previous);
      }
    },
  });

  const handleDismiss = (item: LibraryItem) => {
    const label = item.title || "ce livrable";
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Retirer « ${label} » de la bibliothèque ?\n\nLe job source reste accessible depuis Missions ou Chat.`,
      )
    ) {
      return;
    }
    setDismissFeedback("");
    setDismissError("");
    dismissMut.mutate(item.id);
  };

  const themes = useMemo(() => {
    const raw = library.data?.themes || [];
    if (!filterJob) return raw;
    return raw
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => i.job_id === filterJob || i.sources?.some((s) => s.job_id === filterJob),
        ),
        count: g.items.filter(
          (i) => i.job_id === filterJob || i.sources?.some((s) => s.job_id === filterJob),
        ).length,
      }))
      .filter((g) => g.count > 0);
  }, [library.data, filterJob]);

  const total = themes.reduce((n, g) => n + g.count, 0);
  const rawTotal = library.data?.raw_total;

  return (
    <PageShell size="wide">
      <PageHeader
        accent="emerald"
        badge="Bibliothèque"
        title="Livrables générés"
        description="Fichiers Drive et pièces opérationnelles, regroupés par thématique. Les doublons (même fichier ou même contenu) sont fusionnés automatiquement."
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

      {library.data && rawTotal != null && rawTotal > total ? (
        <AlertBox tone="info" title={`${total} livrables uniques (${rawTotal} entrées brutes regroupées)`}>
          Les livrables identiques — même fichier Google ou même titre — sont fusionnés pour simplifier la lecture.
        </AlertBox>
      ) : null}

      {library.isLoading ? <LoadingLine /> : null}
      {library.isError ? (
        <AlertBox tone="error" title="Bibliothèque indisponible">
          Vérifiez que le backend est démarré (redémarrage requis après mise à jour), puis rechargez.
        </AlertBox>
      ) : null}

      {dismissFeedback ? <AlertBox tone="success">{dismissFeedback}</AlertBox> : null}
      {dismissError ? <AlertBox tone="error">{dismissError}</AlertBox> : null}

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
                <DeliverableCard
                  key={item.id}
                  item={item}
                  onDismiss={handleDismiss}
                  dismissBusy={dismissMut.isPending}
                />
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
    <Suspense
      fallback={
        <PageShell size="wide">
          <LoadingLine />
        </PageShell>
      }
    >
      <LivrablesContent />
    </Suspense>
  );
}
