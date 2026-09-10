"use client";

import { useState } from "react";
import type { EmailAttachment } from "../../lib/business";
import { canInlineEmailAttachment, emailFileUrl, emailMessageAttachmentUrl } from "../../lib/business";

function formatSize(size?: number): string {
  const n = Number(size || 0);
  if (!n) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

type Viewer = { url: string; downloadUrl: string; filename: string; mime: string };

function AttachmentViewer({ viewer, onClose }: { viewer: Viewer; onClose: () => void }) {
  const isImage = viewer.mime.startsWith("image/");
  const isPdf = viewer.mime === "application/pdf" || viewer.filename.toLowerCase().endsWith(".pdf");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p className="truncate text-sm font-semibold text-slate-900">{viewer.filename}</p>
          <div className="flex shrink-0 items-center gap-2">
            <a href={viewer.downloadUrl} className="btn-secondary text-xs">
              Télécharger
            </a>
            <button type="button" className="btn-secondary text-xs" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
        <div className="min-h-[240px] bg-slate-100">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewer.url} alt={viewer.filename} className="mx-auto max-h-[80vh] w-auto object-contain" />
          ) : isPdf ? (
            <iframe title={viewer.filename} src={viewer.url} className="h-[80vh] w-full border-0" />
          ) : (
            <p className="p-6 text-sm text-slate-600">
              Aperçu indisponible pour ce type de fichier. Utilisez Télécharger.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type ListProps = {
  attachments: EmailAttachment[];
  messageId?: string;
  onRemove?: (id: string) => void;
};

export function EmailAttachmentList({ attachments, messageId, onRemove }: ListProps) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  if (!attachments.length) return null;

  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-2">
        {attachments.map((att) => {
          const url = messageId
            ? emailMessageAttachmentUrl(messageId, att.id, false)
            : emailFileUrl(att.id, false);
          const inlineUrl = messageId
            ? emailMessageAttachmentUrl(messageId, att.id, true)
            : emailFileUrl(att.id, true);
          const previewable = canInlineEmailAttachment(att.mime);
          return (
            <li
              key={att.id}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
            >
              <span className="truncate" title={att.filename}>
                {att.filename}
                {att.size ? ` · ${formatSize(att.size)}` : ""}
              </span>
              {previewable ? (
                <button
                  type="button"
                  className="font-semibold text-teal-800 hover:underline"
                  onClick={() =>
                    setViewer({
                      url: inlineUrl,
                      downloadUrl: url,
                      filename: att.filename,
                      mime: att.mime || "",
                    })
                  }
                >
                  Ouvrir
                </button>
              ) : null}
              <a href={url} className="font-semibold text-slate-700 hover:underline" download>
                Télécharger
              </a>
              {onRemove ? (
                <button
                  type="button"
                  className="font-semibold text-red-700 hover:underline"
                  onClick={() => onRemove(att.id)}
                >
                  Retirer
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {viewer ? <AttachmentViewer viewer={viewer} onClose={() => setViewer(null)} /> : null}
    </>
  );
}
