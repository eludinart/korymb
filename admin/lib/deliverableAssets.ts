import { deliverablesForMissionPanel } from "./extractTeamDeliverables";
import { openEmailDraft } from "./mailtoDraft";
import type { DriveArtifact } from "./types";

/** Canal de diffusion — extensible (email, réseaux sociaux, etc.). */
export type DeliverableChannel =
  | "drive_sheet"
  | "drive_doc"
  | "drive_file"
  | "in_app"
  | "email_draft"
  | "linkedin"
  | "facebook"
  | "telegram";

export type DeliverableAsset = {
  id: string;
  title: string;
  channel: DeliverableChannel;
  href?: string;
  agentKey?: string;
  /** Ancre DOM pour scroll vers le livrable in-app (`#livrable-…`). */
  anchorId?: string;
  markdownBody?: string;
};

const CHANNEL_META: Record<
  DeliverableChannel,
  { label: string; actionLabel: string; style: string; external: boolean }
> = {
  drive_sheet: {
    label: "Google Sheet",
    actionLabel: "Ouvrir le tableau",
    style: "border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100",
    external: true,
  },
  drive_doc: {
    label: "Google Doc",
    actionLabel: "Ouvrir le document",
    style: "border-blue-200 bg-blue-50 text-blue-950 hover:bg-blue-100",
    external: true,
  },
  drive_file: {
    label: "Google Drive",
    actionLabel: "Ouvrir sur Drive",
    style: "border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100",
    external: true,
  },
  in_app: {
    label: "Dans Korymb",
    actionLabel: "Voir le contenu",
    style: "border-violet-200 bg-violet-50 text-violet-950 hover:bg-violet-100",
    external: false,
  },
  email_draft: {
    label: "Email",
    actionLabel: "Brouillon email",
    style: "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100",
    external: false,
  },
  linkedin: {
    label: "LinkedIn",
    actionLabel: "Publier (bientôt)",
    style: "border-sky-200 bg-sky-50 text-sky-900 opacity-60",
    external: false,
  },
  facebook: {
    label: "Facebook",
    actionLabel: "Publier (bientôt)",
    style: "border-indigo-200 bg-indigo-50 text-indigo-900 opacity-60",
    external: false,
  },
  telegram: {
    label: "Telegram",
    actionLabel: "Publier (bientôt)",
    style: "border-cyan-200 bg-cyan-50 text-cyan-900 opacity-60",
    external: false,
  },
};

export function deliverableChannelMeta(channel: DeliverableChannel) {
  return CHANNEL_META[channel] || CHANNEL_META.in_app;
}

function slugAnchor(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-àâäéèêëïîôùûüç]/gi, "")
      .slice(0, 48) || "livrable"
  );
}

/** Id DOM stable pour scroll vers un livrable in-app. */
export function livrableAnchorId(title: string): string {
  return `livrable-${slugAnchor(title)}`;
}

function driveChannelFromKind(kind?: string, name?: string): DeliverableChannel {
  const k = String(kind || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  if (k.includes("sheet") || n.includes(".csv")) return "drive_sheet";
  if (k.includes("doc") || n.endsWith(".md")) return "drive_doc";
  return "drive_file";
}

/** Liens Drive présents dans le markdown de résultat (section auto-export). */
export function extractDriveLinksFromMarkdown(md: string): Array<{ title: string; href: string }> {
  const out: Array<{ title: string; href: string }> = [];
  const re = /\[([^\]]+)\]\((https?:\/\/(?:drive|docs)\.google\.com\/[^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md || ""))) {
    out.push({ title: m[1].trim(), href: m[2].trim() });
  }
  return out;
}

export function buildDeliverableAssets(opts: {
  jobId: string;
  deliverablesMarkdown: string;
  driveArtifacts?: DriveArtifact[] | null;
  result?: string | null;
}): DeliverableAsset[] {
  const assets: DeliverableAsset[] = [];
  const seenHref = new Set<string>();
  const seenId = new Set<string>();

  const push = (asset: DeliverableAsset) => {
    if (asset.href && seenHref.has(asset.href)) return;
    if (seenId.has(asset.id)) return;
    if (asset.href) seenHref.add(asset.href);
    seenId.add(asset.id);
    assets.push(asset);
  };

  for (const d of opts.driveArtifacts || []) {
    const href = String(d.webViewLink || d.url || "").trim();
    if (!href) continue;
    push({
      id: `drive:${opts.jobId}:${d.id || href}`,
      title: String(d.name || "Fichier Drive").trim(),
      channel: driveChannelFromKind(d.kind, d.name),
      href,
      agentKey: d.agent ? String(d.agent) : undefined,
    });
  }

  const md = `${opts.result || ""}\n${opts.deliverablesMarkdown || ""}`;
  for (const link of extractDriveLinksFromMarkdown(md)) {
    const ch = link.href.includes("spreadsheets") ? "drive_sheet" : link.href.includes("document") ? "drive_doc" : "drive_file";
    push({
      id: `mdlink:${opts.jobId}:${link.href}`,
      title: link.title,
      channel: ch,
      href: link.href,
    });
  }

  const combinedForInApp = `${opts.deliverablesMarkdown || ""}\n${opts.result || ""}`.trim();
  for (const [idx, item] of deliverablesForMissionPanel(combinedForInApp).entries()) {
    const anchorId = livrableAnchorId(item.title);
    const titleLower = item.title.toLowerCase();
    const hasDrive = assets.some(
      (a) => a.href && (a.title.toLowerCase().includes(titleLower.slice(0, 24)) || titleLower.includes(a.title.toLowerCase().slice(0, 24))),
    );

    push({
      id: `in_app:${opts.jobId}:${anchorId}:${idx}`,
      title: item.title,
      channel: "in_app",
      anchorId,
      markdownBody: item.body,
    });

    if (!hasDrive && item.body.trim().length > 40) {
      push({
        id: `email:${opts.jobId}:${anchorId}:${idx}`,
        title: `${item.title} — brouillon`,
        channel: "email_draft",
        anchorId,
        markdownBody: item.body,
      });
    }
  }

  return assets;
}

export function scrollToDeliverableAnchor(anchorId: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(anchorId);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-violet-400");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-violet-400"), 2200);
  }
}

export function openDeliverableAsset(asset: DeliverableAsset) {
  const meta = deliverableChannelMeta(asset.channel);
  if (asset.channel === "in_app" && asset.anchorId) {
    scrollToDeliverableAnchor(asset.anchorId);
    return;
  }
  if (asset.channel === "email_draft" && asset.markdownBody) {
    openEmailDraft(asset.title, asset.markdownBody);
    return;
  }
  if (meta.external && asset.href) {
    window.open(asset.href, "_blank", "noopener,noreferrer");
  }
}
