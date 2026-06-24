"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DeliverableAccessHub from "../deliverables/DeliverableAccessHub";
import { extractJobIdFromMessageId, fetchChatJobDelivery } from "@/lib/chatJobAgents";
import type { DriveArtifact } from "@/lib/types";
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
    if (deliverablesMarkdown.includes("#### LIVRABLE")) return true;
    if (/drive\.google\.com|docs\.google\.com/.test(message.content)) return true;
    return false;
  }, [driveArtifacts, deliverablesMarkdown, message.content]);

  if (!jobId || message.role !== "assistant" || message.id.startsWith("ack-")) return null;
  if (!hasContent && !loading) return null;

  return (
    <div className="mt-2 max-w-[90%] space-y-2">
      {loading ? (
        <p className="text-[11px] text-slate-500">Chargement des liens livrables…</p>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2.5">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
            Livrables — accès direct
          </p>
          <DeliverableAccessHub
            jobId={jobId}
            deliverablesMarkdown={deliverablesMarkdown || message.content}
            driveArtifacts={driveArtifacts}
            result={message.content}
            compact
          />
          <p className="mt-2 text-[10px] text-slate-500">
            <Link href="/livrables" className="font-semibold text-violet-700 hover:underline">
              Tous les livrables
            </Link>
            {" · "}
            <Link href={`/livrables?job=${encodeURIComponent(jobId)}`} className="text-violet-700 hover:underline">
              Contexte mission
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
