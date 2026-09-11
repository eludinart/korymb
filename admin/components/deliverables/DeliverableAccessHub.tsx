"use client";

import { useMemo, useState } from "react";
import {
  buildDeliverableAssets,
  deliverableChannelMeta,
  isLocalFileChannel,
  openDeliverableAsset,
  scrollToDeliverableAnchor,
  type DeliverableAsset,
} from "../../lib/deliverableAssets";
import { loadResourcePreviewView, type ResourcePreviewView } from "../../lib/resourceFilePreview";
import type { DriveArtifact } from "../../lib/types";
import InAppDeliverableModal from "./InAppDeliverableModal";

type Props = {
  jobId: string;
  deliverablesMarkdown?: string;
  driveArtifacts?: DriveArtifact[] | null;
  result?: string | null;
  /** Affichage compact (une ligne de pastilles). */
  compact?: boolean;
  className?: string;
  /** Assets pré-calculés (optionnel). */
  assets?: DeliverableAsset[];
};

type ViewerState = ResourcePreviewView;

export default function DeliverableAccessHub({
  jobId,
  deliverablesMarkdown = "",
  driveArtifacts,
  result,
  compact = false,
  className = "",
  assets: assetsProp,
}: Props) {
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const assets = useMemo(() => {
    const raw =
      assetsProp ||
      buildDeliverableAssets({
        jobId,
        deliverablesMarkdown,
        driveArtifacts,
        result,
      });
    const seen = new Set<string>();
    return raw.filter((asset) => {
      if (seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    });
  }, [assetsProp, jobId, deliverablesMarkdown, driveArtifacts, result]);

  const combinedMarkdown = `${deliverablesMarkdown || ""}\n${result || ""}`;
  const operational = assets.filter((a) => a.channel !== "linkedin" && a.channel !== "facebook" && a.channel !== "telegram");
  if (!operational.length && !viewer) return null;

  const fileCount = operational.filter((a) => a.channel.startsWith("drive_") || a.channel.startsWith("local_")).length;
  const inAppCount = operational.filter((a) => a.channel === "in_app").length;

  const openMarkdown = (title: string, body: string, notice?: string) => {
    setViewer({ title, body, notice });
  };

  const handleOpen = (asset: DeliverableAsset) => {
    if (isLocalFileChannel(asset.channel)) {
      void openLocalFile(asset);
      return;
    }
    if (asset.channel === "in_app" && asset.markdownBody) {
      if (!compact && asset.anchorId && typeof document !== "undefined" && document.getElementById(asset.anchorId)) {
        scrollToDeliverableAnchor(asset.anchorId);
        return;
      }
      openMarkdown(asset.title, asset.markdownBody);
      return;
    }
    openDeliverableAsset(asset);
  };

  const openLocalFile = async (asset: DeliverableAsset) => {
    setViewer({ title: asset.title, body: "", loading: true });
    const view = await loadResourcePreviewView({
      title: asset.title,
      href: asset.href,
      fallbackMarkdown: asset.markdownBody,
      combinedMarkdown,
    });
    setViewer(view);
  };

  const modal = (
    <InAppDeliverableModal
      open={Boolean(viewer)}
      title={viewer?.title || ""}
      body={viewer?.body || ""}
      notice={viewer?.notice}
      loading={Boolean(viewer?.loading)}
      downloadName={viewer?.downloadName}
      downloadText={viewer?.downloadText}
      onClose={() => setViewer(null)}
    />
  );

  if (!operational.length) return modal;

  if (compact) {
    return (
      <>
        <div className={`flex flex-wrap gap-1.5 ${className}`}>
          {operational.map((asset) => {
            const meta = deliverableChannelMeta(asset.channel);
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => handleOpen(asset)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${meta.style}`}
                title={asset.title}
              >
                {meta.actionLabel}
                <span className="ml-1 font-normal opacity-80">
                  · {asset.title.slice(0, 36)}
                  {asset.title.length > 36 ? "…" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {modal}
      </>
    );
  }

  return (
    <>
      <section
        className={`rounded-2xl border-2 border-emerald-200/90 bg-gradient-to-b from-emerald-50/90 to-white shadow-sm ${className}`}
        aria-label="Accès aux livrables"
      >
        <header className="border-b border-emerald-100 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-900">Livrables — accès rapide</p>
          <p className="mt-1 text-xs leading-relaxed text-emerald-900/75">
            {fileCount > 0
              ? `${fileCount} fichier${fileCount > 1 ? "s" : ""} dans votre espace`
              : "Aucun fichier enregistré pour l'instant"}
            {inAppCount > 0 ? ` · ${inAppCount} pièce${inAppCount > 1 ? "s" : ""} lisible${inAppCount > 1 ? "s" : ""} dans Korymb` : ""}
            . Lecture dans Korymb ; Google Drive s’ouvre à part.
          </p>
        </header>
        <ul className="grid gap-2 p-3 sm:grid-cols-2">
          {operational.map((asset) => {
            const meta = deliverableChannelMeta(asset.channel);
            return (
              <li
                key={asset.id}
                className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm"
              >
                <div className="min-w-0">
                  <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                    {meta.label}
                  </span>
                  <p className="mt-1.5 text-sm font-semibold leading-snug text-slate-900">{asset.title}</p>
                  {asset.agentKey ? (
                    <p className="mt-0.5 text-[10px] font-medium text-slate-500">Agent : {asset.agentKey}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleOpen(asset)}
                  className={`w-full rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${meta.style}`}
                >
                  {meta.actionLabel}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-emerald-100 px-4 py-2 text-[10px] text-slate-500">
          Publication LinkedIn, Facebook, Telegram et envoi email automatisé : prochaines étapes de la plateforme.
        </p>
      </section>
      {modal}
    </>
  );
}
