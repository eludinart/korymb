"use client";

import { useMemo } from "react";
import {
  buildDeliverableAssets,
  deliverableChannelMeta,
  openDeliverableAsset,
  type DeliverableAsset,
} from "../../lib/deliverableAssets";
import type { DriveArtifact } from "../../lib/types";

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

export default function DeliverableAccessHub({
  jobId,
  deliverablesMarkdown = "",
  driveArtifacts,
  result,
  compact = false,
  className = "",
  assets: assetsProp,
}: Props) {
  const assets = useMemo(
    () =>
      assetsProp ||
      buildDeliverableAssets({
        jobId,
        deliverablesMarkdown,
        driveArtifacts,
        result,
      }),
    [assetsProp, jobId, deliverablesMarkdown, driveArtifacts, result],
  );

  const operational = assets.filter((a) => a.channel !== "linkedin" && a.channel !== "facebook" && a.channel !== "telegram");
  if (!operational.length) return null;

  const driveCount = operational.filter((a) => a.channel.startsWith("drive_")).length;
  const inAppCount = operational.filter((a) => a.channel === "in_app").length;

  if (compact) {
    return (
      <div className={`flex flex-wrap gap-1.5 ${className}`}>
        {operational.map((asset) => {
          const meta = deliverableChannelMeta(asset.channel);
          return (
            <button
              key={asset.id}
              type="button"
              onClick={() => openDeliverableAsset(asset)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${meta.style}`}
              title={asset.title}
            >
              {meta.actionLabel}
              <span className="ml-1 font-normal opacity-80">· {asset.title.slice(0, 36)}{asset.title.length > 36 ? "…" : ""}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section
      className={`rounded-2xl border-2 border-emerald-200/90 bg-gradient-to-b from-emerald-50/90 to-white shadow-sm ${className}`}
      aria-label="Accès aux livrables"
    >
      <header className="border-b border-emerald-100 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-900">Livrables — accès rapide</p>
        <p className="mt-1 text-xs leading-relaxed text-emerald-900/75">
          {driveCount > 0 ? `${driveCount} fichier${driveCount > 1 ? "s" : ""} sur Drive` : "Aucun fichier Drive pour l'instant"}
          {inAppCount > 0 ? ` · ${inAppCount} pièce${inAppCount > 1 ? "s" : ""} dans Korymb` : ""}
          . Chaque proposition opérationnelle est accessible en un clic.
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
                onClick={() => openDeliverableAsset(asset)}
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
  );
}
