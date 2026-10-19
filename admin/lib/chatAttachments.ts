export type ChatFile = {
  id: string;
  filename: string;
  mime?: string;
  size?: number;
};

export const CHAT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.mp4,.webm,.mov,.mp3,.m4a,.wav,.ogg,.aac";

/** Galerie / caméra : sans liste d'extensions, sinon iOS ouvre « Fichiers » au lieu des photos. */
export const CHAT_ACCEPT_MEDIA = "image/*,video/*";
export const CHAT_ACCEPT_CAMERA = "image/*,video/*";

export const CHAT_FILE_MAX = 6;

export function formatChatFileSize(size?: number): string {
  const n = Number(size || 0);
  if (!n) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function chatFileKind(mime?: string, filename?: string): "image" | "video" | "audio" | "pdf" | "file" {
  const m = (mime || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(n)) return "image";
  if (m.startsWith("video/") || /\.(mp4|webm|mov)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac)$/.test(n)) return "audio";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  return "file";
}

export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files?.length) return Array.from(dt.files);
  const out: File[] = [];
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

export function filesFromClipboard(e: ClipboardEvent | { clipboardData?: DataTransfer | null }): File[] {
  return filesFromDataTransfer(e.clipboardData ?? null);
}
