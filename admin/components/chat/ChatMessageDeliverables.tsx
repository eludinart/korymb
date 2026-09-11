"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DeliverableAccessHub from "../deliverables/DeliverableAccessHub";
import { extractJobIdFromMessageId, fetchChatJobDelivery } from "../../lib/chatJobAgents";
import type { DriveArtifact } from "../../lib/types";
import type { ChatMsg } from "./ChatShell";

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

  return (
    <div className="mt-1.5 w-full space-y-1">
      {loading ? (
        <p className="text-[11px] text-slate-500">Chargement des liens livrables…</p>
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/90 px-2.5 py-1.5 sm:rounded-xl sm:px-3 sm:py-2.5">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-900 sm:mb-2">
            Livrables
          </p>
          <DeliverableAccessHub
            jobId={jobId}
            deliverablesMarkdown={deliverablesMarkdown || message.content}
            driveArtifacts={driveArtifacts}
            result={message.content}
            compact
          />
          <p className="mt-1.5 hidden text-[10px] text-slate-500 sm:mt-2 sm:block">
            <Link href="/gestion/livrables" className="font-semibold text-violet-700 hover:underline">
              Tous les livrables
            </Link>
            {" · "}
            <Link href={`/gestion/livrables?job=${encodeURIComponent(jobId)}`} className="text-violet-700 hover:underline">
              Contexte mission
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
