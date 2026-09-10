"use client";

import { useState } from "react";
import { businessApi, resourceFileUrl, type EmailAttachment } from "../../lib/business";
import { humanizeStoredFilename } from "../../lib/storefront";
import { ResourcePreviewModal } from "../espace/ResourcePreview";

const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.mp4,.webm,.mov,.mp3,.m4a,.wav,.ogg,.aac";

function formatSize(size?: number): string {
  const n = Number(size || 0);
  if (!n) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

type Props = {
  file: EmailAttachment | null;
  onFile: (file: EmailAttachment | null) => void;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
};

export function ResourceFileField({ file, onFile, onBusy, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  function setUploadBusy(next: boolean) {
    setBusy(next);
    onBusy?.(next);
  }

  async function onPick(list: FileList | null) {
    const picked = list?.[0];
    if (!picked) return;
    setUploadBusy(true);
    setError("");
    try {
      onFile(await businessApi.uploadResourceFile(picked));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload impossible");
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <span className="font-medium text-slate-700">Fichier à télécharger</span>
      {file ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-semibold text-slate-900">{humanizeStoredFilename(file.filename) || file.filename}</span>
          {file.size ? <span className="text-xs text-slate-500">{formatSize(file.size)}</span> : null}
          <button
            type="button"
            className="text-xs font-bold text-emerald-800 underline"
            onClick={() => setPreview(true)}
          >
            Consulter
          </button>
          <a href={resourceFileUrl(file.id)} className="text-xs font-bold text-emerald-800 underline">
            Télécharger
          </a>
          <button
            type="button"
            className="text-xs font-semibold text-slate-600 underline"
            disabled={disabled || busy}
            onClick={() => {
              setError("");
              setPreview(false);
              onFile(null);
            }}
          >
            Retirer
          </button>
        </div>
      ) : null}
      {file && preview ? (
        <ResourcePreviewModal
          title={humanizeStoredFilename(file.filename) || file.filename}
          mime={file.mime}
          filename={file.filename}
          inlineUrl={resourceFileUrl(file.id, true)}
          downloadUrl={resourceFileUrl(file.id)}
          onClose={() => setPreview(false)}
        />
      ) : null}
      <input
        type="file"
        accept={ACCEPT}
        disabled={disabled || busy}
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
        onChange={(e) => {
          void onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="block text-xs text-slate-500">
        {busy ? "Envoi du fichier…" : "PDF, audio, vidéo, Office — 32 Mo max. Visible aux participants à partir de la date de début, jamais sur la vitrine publique."}
      </span>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
