import { normalizeJobId } from "./missionBossView";

export type DirectorNotification = {
  id: string;
  kind: string;
  title: string;
  body?: string;
  action_url?: string;
  job_id?: string | null;
  output_id?: string | null;
  read_at?: string | null;
  created_at?: string;
  ephemeral?: boolean;
};

export type NotificationAction = {
  id: string;
  label: string;
  href: string;
  primary?: boolean;
};

const KIND_LABELS: Record<string, string> = {
  chat_result: "Chat",
  chat_error: "Chat · erreur",
  hitl: "Validation CIO",
  studio_stale: "Studio",
  scheduler_output: "Approbation",
  learning_suggestion: "Apprentissage",
  email_reply: "Courrier",
  info: "Information",
  test: "Test",
};

const KIND_STYLES: Record<string, string> = {
  chat_result: "bg-violet-100 text-violet-900",
  chat_error: "bg-red-100 text-red-900",
  hitl: "bg-amber-100 text-amber-950",
  studio_stale: "bg-violet-100 text-violet-950",
  scheduler_output: "bg-sky-100 text-sky-950",
  learning_suggestion: "bg-emerald-100 text-emerald-950",
  email_reply: "bg-teal-100 text-teal-950",
  info: "bg-slate-100 text-slate-800",
};

export function notificationKindLabel(kind: string): string {
  const k = kind.trim().toLowerCase();
  return KIND_LABELS[k] || k.replace(/_/g, " ");
}

export function notificationKindStyle(kind: string): string {
  const k = kind.trim().toLowerCase();
  return KIND_STYLES[k] || "bg-slate-100 text-slate-700";
}

export function formatNotificationWhen(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "À l'instant";
  if (diff < 3_600_000) return `Il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `Il y a ${Math.floor(diff / 3_600_000)} h`;
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function primaryLabel(kind: string, href: string): string {
  const k = kind.toLowerCase();
  if (k === "chat_result") return "Ouvrir le chat";
  if (k === "chat_error") return "Voir dans le chat";
  if (k === "hitl") return "Décider";
  if (k === "studio_stale") return "Ouvrir le Studio";
  if (k === "scheduler_output") return "Voir les approbations";
  if (k === "learning_suggestion") {
    if (href.includes("/administration/memory")) return "Voir la mémoire";
    return "Ouvrir Décisions";
  }
  if (k === "email_reply") return "Ouvrir le courrier";
  if (href.includes("/gestion/courrier")) return "Ouvrir le courrier";
  if (href.includes("/missions")) return "Ouvrir la mission";
  if (href.includes("/inbox")) return "Ouvrir Décisions";
  if (href.includes("/chat")) return "Ouvrir le chat";
  return "Ouvrir";
}

/** Actions de navigation dérivées du type et des métadonnées notification. */
export function buildNotificationActions(n: DirectorNotification): NotificationAction[] {
  const actions: NotificationAction[] = [];
  const seen = new Set<string>();
  const kind = String(n.kind || "").toLowerCase();
  const jobId = normalizeJobId(n.job_id);
  const actionUrl = String(n.action_url || "").trim();
  const outputId = String(n.output_id || "").trim();

  const add = (id: string, label: string, href: string, primary = false) => {
    const path = href.trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    actions.push({ id, label, href: path, primary });
  };

  if (actionUrl) {
    add("primary", primaryLabel(kind, actionUrl), actionUrl, true);
  }

  if (jobId) {
    if (kind === "chat_result" || kind === "chat_error") {
      const chatHref = actionUrl.startsWith("/chat") ? actionUrl : `/chat?job=${jobId}`;
      add("chat", "Conversation", chatHref);
      add("mission", "Mission liée", `/missions?job=${jobId}`);
    } else if (kind === "hitl" || kind === "learning_suggestion") {
      add("inbox", "À valider", `/inbox?job=${jobId}`);
      add("mission", "Mission", `/missions?job=${jobId}`);
    } else if (!actionUrl.includes(`/missions?job=${jobId}`)) {
      add("mission", "Mission", `/missions?job=${jobId}`);
    }
  }

  if (kind === "scheduler_output" || outputId) {
    add("approbations", "Approbations", "/administration/approbations");
  }

  if (kind === "hitl" && !seen.has(`/inbox?job=${jobId}`) && jobId) {
    add("inbox-hitl", "Valider le plan", `/inbox?job=${jobId}`);
  }

  if (!actions.length) {
    add("briefing", "Briefing", "/briefing");
  }

  return actions;
}

export function notificationShareUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (typeof window === "undefined") return href;
  return `${window.location.origin}${href.startsWith("/") ? href : `/${href}`}`;
}

/** Types qui interrompent même si l'onglet Korymb est au premier plan. */
const INTERRUPTIVE_NOTIFICATION_KINDS = new Set([
  "hitl",
  "scheduler_output",
  "email_reply",
  "chat_error",
  "action_ticket",
  "config_suggestion",
]);

function normalizePathname(pathname: string): string {
  const path = pathname.split("?")[0] || "";
  return path.replace(/\/+$/, "") || "/";
}

/** La surface actuelle affiche déjà l'info : pas de toast. */
export function notificationConsumedByPath(kind: string, pathname: string): boolean {
  const k = kind.trim().toLowerCase();
  const path = normalizePathname(pathname);
  if ((k === "chat_result" || k === "chat_error") && (path === "/chat" || path.startsWith("/chat/"))) {
    return true;
  }
  if (k === "email_reply" && (path === "/gestion/courrier" || path.startsWith("/gestion/courrier/"))) {
    return true;
  }
  if ((k === "hitl" || k === "action_ticket") && (path === "/inbox" || path.startsWith("/inbox/"))) {
    return true;
  }
  if (k === "scheduler_output" && path.startsWith("/administration/approbations")) {
    return true;
  }
  return false;
}

export function shouldShowNotificationToast(
  kind: string,
  opts: { pathname: string; documentHidden: boolean; ephemeral?: boolean },
): boolean {
  const k = kind.trim().toLowerCase();
  if (notificationConsumedByPath(k, opts.pathname)) return false;
  if (INTERRUPTIVE_NOTIFICATION_KINDS.has(k)) return true;
  // Échos chat, infos, le reste : uniquement si l'onglet n'est plus visible.
  return Boolean(opts.documentHidden);
}

/** Aperçu lisible sans markdown (toasts + liste). */
export function notificationPreviewText(raw?: string | null, max = 180): string {
  if (!raw) return "";
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
