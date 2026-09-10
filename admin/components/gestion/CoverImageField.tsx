"use client";

import { useState } from "react";
import { businessApi, resourceFileUrl, type EmailAttachment } from "../../lib/business";
import { humanizeStoredFilename } from "../../lib/storefront";

type Props = {
  file: EmailAttachment | null;
  onFile: (file: EmailAttachment | null) => void;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
};

export function CoverImageField({
  file,
  onFile,
  onBusy,
  disabled,
  label = "Image de couverture",
  hint = "PNG, JPEG, WebP ou GIF — affichée sur la vitrine et dans l’espace inscrit. Si la ressource jointe est déjà une image, elle sert aussi de visuel.",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function setUploadBusy(next: boolean) {
    setBusy(next);
    onBusy?.(next);
  }

  async function onPick(list: FileList | null) {
    const picked = list?.[0];
    if (!picked) return;
    if (!picked.type.startsWith("image/")) {
      setError("Choisissez une image (PNG, JPEG, WebP ou GIF).");
      return;
    }
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

  const previewUrl = file?.id ? resourceFileUrl(file.id, true) : "";

  return (
    <div className="space-y-2">
      <span className="font-medium text-slate-700">{label}</span>
      {file && previewUrl ? (
        <div className="overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="h-36 w-full object-cover" />
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="font-semibold text-slate-900">
              {humanizeStoredFilename(file.filename) || file.filename}
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-slate-600 underline"
              disabled={disabled || busy}
              onClick={() => {
                setError("");
                onFile(null);
              }}
            >
              Retirer
            </button>
          </div>
        </div>
      ) : null}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
        disabled={disabled || busy}
        className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
        onChange={(e) => {
          void onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="block text-xs text-slate-500">{busy ? "Envoi de l’image…" : hint}</span>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
