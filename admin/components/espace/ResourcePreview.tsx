"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ResourcePreviewModal({
  title,
  mime,
  filename,
  inlineUrl,
  downloadUrl,
  onClose,
}: {
  title: string;
  mime?: string;
  filename?: string;
  inlineUrl: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const kind = previewKind(mime, filename);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          <div className="flex shrink-0 items-center gap-2">
            <a href={downloadUrl} className="btn-secondary text-xs">
              Télécharger
            </a>
            <button type="button" className="btn-secondary text-xs" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
        <div className="min-h-[240px] overflow-auto bg-slate-100">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={inlineUrl} alt={title} className="mx-auto max-h-[80vh] max-w-full object-contain" />
          ) : kind === "pdf" ? (
            <iframe title={title} src={inlineUrl} className="h-[80vh] w-full border-0" />
          ) : kind === "video" ? (
            <video src={inlineUrl} controls className="mx-auto max-h-[80vh] w-full bg-black" />
          ) : kind === "audio" ? (
            <div className="flex items-center justify-center p-8">
              <audio src={inlineUrl} controls className="w-full max-w-xl" />
            </div>
          ) : kind === "text" ? (
            <iframe title={title} src={inlineUrl} className="h-[80vh] w-full border-0 bg-white" />
          ) : (
            <p className="p-6 text-sm text-slate-600">
              Aperçu indisponible pour ce type de fichier. Utilisez Télécharger pour l’ouvrir sur votre appareil.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function previewKind(mime?: string, filename?: string): "image" | "pdf" | "video" | "audio" | "text" | "other" {
  const m = (mime || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(n)) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.startsWith("video/") || /\.(mp4|webm|mov)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac)$/.test(n)) return "audio";
  if (m.startsWith("text/") || /\.(txt|md|csv)$/.test(n)) return "text";
  return "other";
}
