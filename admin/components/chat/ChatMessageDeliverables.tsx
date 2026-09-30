"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DeliverableAccessHub from "../deliverables/DeliverableAccessHub";
import { extractJobIdFromMessageId, fetchChatJobDelivery } from "../../lib/chatJobAgents";
import type { DriveArtifact } from "../../lib/types";
import type { ChatMsg } from "./ChatShell";
import ChatBottomSheet from "./ChatBottomSheet";

type Props = {
  message: ChatMsg;
};

export default function ChatMessageDeliverables({ message }: Props) {
  const jobId = message.jobId || extractJobIdFromMessageId(message.id);
  const [driveArtifacts, setDriveArtifacts] = useState<DriveArtifact[] | null>(
    message.driveArtifacts ?? null,
  );
  const [deliverablesMarkdown, setDeliverablesMarkdown] = useState(
    message.deliverablesMarkdown ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!jobId || message.role !== "assistant" || message.id.startsWith("ack-")) return;
    if (message.driveArtifacts?.length || message.deliverablesMarkdown) return;
    let cancelled = false;
    setLoading(true);
    void fetchChatJobDelivery(jobId)
      .then((d) => {
        if (cancelled) return;
        setDriveArtifacts(d.driveArtifacts);
        setDeliverablesMarkdown(d.deliverablesMarkdown);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, message]);

  const hasContent = useMemo(() => {
    if ((driveArtifacts || []).length) return true;
    const blob = `${deliverablesMarkdown}\n${message.content}`;
    if (/####\s+LIVRABLE/.test(blob)) return true;
    if (/drive\.google\.com|docs\.google\.com/.test(blob)) return true;
    if (/resource-files\/|rfil-/.test(blob)) return true;
    return false;
  }, [driveArtifacts, deliverablesMarkdown, message.content]);

  if (!jobId || message.role !== "assistant" || message.id.startsWith("ack-")) return null;
  if (!hasContent && !loading) return null;

  const hub = (
    <DeliverableAccessHub
      jobId={jobId}
      deliverablesMarkdown={deliverablesMarkdown || message.content}
      driveArtifacts={driveArtifacts}
      result={message.content}
      compact
    />
  );

  return (
    <div className="mt-1.5 w-full space-y-1">
      {loading ? (
        <p className="text-[11px] text-slate-500">Chargement des liens livrables…</p>
      ) : (
        <>
          {/* Mobile : chip → sheet */}
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 active:bg-emerald-100"
            >
              Voir les livrables
              <span aria-hidden>→</span>
            </button>
            <ChatBottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Livrables" tall>
              <div className="space-y-3 pb-4">
                {hub}
                <p className="text-[11px] text-slate-500">
                  <Link href="/gestion/livrables" className="font-semibold text-violet-700">
                    Tous les livrables
                  </Link>
                  {" · "}
                  <Link
                    href={`/gestion/livrables?job=${encodeURIComponent(jobId)}`}
                    className="text-violet-700"
                  >
                    Contexte mission
                  </Link>
                </p>
              </div>
            </ChatBottomSheet>
          </div>

          {/* Desktop : panneau inline */}
          <div className="hidden rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2.5 lg:block">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-emerald-900">Livrables</p>
            {hub}
            <p className="mt-2 text-[10px] text-slate-500">
              <Link href="/gestion/livrables" className="font-semibold text-violet-700 hover:underline">
                Tous les livrables
              </Link>
              {" · "}
              <Link
                href={`/gestion/livrables?job=${encodeURIComponent(jobId)}`}
                className="text-violet-700 hover:underline"
              >
                Contexte mission
              </Link>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
