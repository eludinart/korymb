"use client";

import { resourceFileUrl } from "../../lib/business";
import { chatFileKind, formatChatFileSize, type ChatFile } from "../../lib/chatAttachments";

export default function ChatMessageFiles({ files }: { files?: ChatFile[] }) {
  if (!files?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {files.map((f) => {
        const kind = chatFileKind(f.mime, f.filename);
        const href = resourceFileUrl(f.id, kind === "image" || kind === "video" || kind === "audio" || kind === "pdf");
        if (kind === "image") {
          return (
            <a
              key={f.id}
              href={resourceFileUrl(f.id, true)}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-xl border border-white/20 bg-black/20"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resourceFileUrl(f.id, true)} alt={f.filename} className="max-h-40 max-w-[14rem] object-cover" />
            </a>
          );
        }
        return (
          <a
            key={f.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-medium text-white/95 underline-offset-2 hover:underline"
          >
            <span className="truncate">{f.filename}</span>
            {f.size ? <span className="shrink-0 opacity-70">{formatChatFileSize(f.size)}</span> : null}
          </a>
        );
      })}
    </div>
  );
}
