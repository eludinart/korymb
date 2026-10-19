import { agentHeaders, requestJson } from "./api";
import { csvToMarkdownTable, matchingLivrableBody, resourceFileIdFromHref } from "./deliverableAssets";

export type ResourcePreviewView = {
  title: string;
  body: string;
  notice?: string;
  loading?: boolean;
  downloadName?: string;
  downloadText?: string;
};

export async function loadResourcePreviewView(opts: {
  title: string;
  href?: string;
  fallbackMarkdown?: string;
  combinedMarkdown?: string;
}): Promise<ResourcePreviewView> {
  const fallback =
    String(opts.fallbackMarkdown || "").trim() ||
    matchingLivrableBody(opts.title, opts.combinedMarkdown || "");
  const fileId = resourceFileIdFromHref(opts.href);
  if (fileId) {
    try {
      const { data } = await requestJson(`/business/resource-files/${encodeURIComponent(fileId)}/preview`, {
        headers: agentHeaders(),
        retries: 1,
      });
      const kind = String(data.kind || "");
      const text = String(data.text || "");
      const filename = String(data.filename || opts.title);
      if (kind === "binary" || data.error || !text.trim()) {
        return {
          title: opts.title,
          body: fallback || String(data.error || "Aperçu indisponible pour ce fichier."),
          notice: fallback ? "Aperçu fichier brut indisponible — contenu repris du chat." : undefined,
          downloadName: filename,
        };
      }
      return {
        title: opts.title,
        body: kind === "csv" ? csvToMarkdownTable(text) : text,
        downloadName: filename,
        downloadText: text,
      };
    } catch {
      /* fallback chat */
    }
  }
  if (fallback) {
    return {
      title: opts.title,
      body: fallback,
      notice: fileId
        ? "Fichier absent du serveur (souvent après un redéploiement). Contenu repris du chat."
        : undefined,
    };
  }
  return {
    title: opts.title,
    body: "Ce livrable n’est plus disponible sur le serveur. Relancez l’export depuis le chat, ou ouvrez le texte déjà affiché dans la conversation.",
  };
}
