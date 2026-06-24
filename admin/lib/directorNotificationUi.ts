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
  scheduler_output: "Approbation",
  learning_suggestion: "Apprentissage",
  info: "Information",
  test: "Test",
};

const KIND_STYLES: Record<string, string> = {
  chat_result: "bg-violet-100 text-violet-900",
  chat_error: "bg-red-100 text-red-900",
  hitl: "bg-amber-100 text-amber-950",
  scheduler_output: "bg-sky-100 text-sky-950",
  learning_suggestion: "bg-emerald-100 text-emerald-950",
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
  if (k === "hitl") return "Décider (inbox)";
  if (k === "scheduler_output") return "Voir les approbations";
  if (k === "learning_suggestion") return "Traiter (inbox)";
  if (href.includes("/missions")) return "Ouvrir la mission";
  if (href.includes("/inbox")) return "Ouvrir l'inbox";
  if (href.includes("/chat")) return "Ouvrir le chat";
  return "Ouvrir";
}

/** Actions de navigation dérivées du type et des métadonnées notification. */
export function buildNotificationActions(n: DirectorNotification): NotificationAction[] {
  const actions: NotificationAction[] = [];
  const seen = new Set<string>();
  const kind = String(n.kind || "").toLowerCase();
  const jobId = String(n.job_id || "").trim().slice(0, 16);
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
      add("inbox", "Inbox", `/inbox?job=${jobId}`);
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
