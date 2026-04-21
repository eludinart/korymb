"use client";

import AgentMessageMarkdown from "./AgentMessageMarkdown";
import { formatEventTs } from "../lib/missionEvents";

type Msg = { role?: string; content?: string; ts?: string; agent?: string };

type Props = {
  messages: unknown;
  title?: string;
  className?: string;
  maxHeightClass?: string;
};

export default function SessionCadrageTimeline({
  messages,
  title = "Echanges de cadrage",
  className = "",
  maxHeightClass = "max-h-80",
}: Props) {
  const list = Array.isArray(messages) ? (messages as Msg[]) : [];

  if (list.length === 0) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${className}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <p className="mt-2 text-sm text-slate-500">Aucun message pour cette session.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-slate-200 bg-white ${className}`}>
      <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className={`space-y-3 overflow-y-auto px-3 py-3 ${maxHeightClass}`}>
        {list.map((m, idx) => {
          const role = String(m.role || "?");
          const isUser = role === "user";
          return (
            <div key={`${m.ts || ""}-${idx}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm ${
                  isUser ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-800"
                }`}
              >
                <p className={`text-[10px] font-mono mb-1 ${isUser ? "text-slate-300" : "text-slate-500"}`}>
                  {formatEventTs(m.ts)} · {role}
                  {m.agent ? <span className="font-medium"> · {m.agent}</span> : null}
                </p>
                {isUser ? (
                  <p className="whitespace-pre-wrap leading-snug">{String(m.content || "")}</p>
                ) : (
                  <AgentMessageMarkdown source={String(m.content || "")} className="leading-snug" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
