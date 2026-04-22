"use client";

import { useState } from "react";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import { formatEventTs } from "../lib/missionEvents";

type Msg = { role?: string; content?: string; ts?: string; agent?: string };

type Props = {
  messages: unknown;
  title?: string;
  className?: string;
  maxHeightClass?: string;
};

/** Un "tour" = un message utilisateur + toutes les réponses CIO qui suivent. */
type Turn = {
  id: string;
  idx: number;        // 0-based
  userMsg: Msg | null;
  cioMsgs: Msg[];
};

const msgIdentity = (m: Msg | null | undefined, fallback: string): string => {
  if (!m) return fallback;
  const ts = String(m.ts || "");
  const role = String(m.role || "");
  const content = String(m.content || "").slice(0, 36);
  const agent = String(m.agent || "");
  return `${role}:${agent}:${ts}:${content}`;
};

function groupIntoTurns(list: Msg[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const m of list) {
    const role = String(m.role ?? "?");
    if (role === "user") {
      // Même « tour » tant que le CIO n'a pas répondu : le dirigeant peut enchainer
      // (ex. « la suite » puis « et alors ? ») avant la fin du job chat ; sans cela la
      // réponse assistant se rattache au dernier user et le tour précédent reste « en attente ».
      if (current && current.cioMsgs.length === 0 && current.userMsg) {
        const a = String(current.userMsg.content || "").trim();
        const b = String(m.content || "").trim();
        current.userMsg = {
          ...current.userMsg,
          content: a && b ? `${a}\n\n—\n\n${b}` : a || b,
          ts: m.ts || current.userMsg.ts,
        };
        current.id = `turn:${msgIdentity(current.userMsg, `user-${current.idx}`)}`;
        continue;
      }
      if (current) turns.push(current);
      current = {
        id: `turn:${msgIdentity(m, `user-${turns.length}`)}`,
        idx: turns.length,
        userMsg: m,
        cioMsgs: [],
      };
    } else if (current) {
      current.cioMsgs.push(m);
    } else {
      // Réponse CIO avant tout message utilisateur (edge case)
      current = {
        id: `turn:edge:${msgIdentity(m, "edge-0")}`,
        idx: 0,
        userMsg: null,
        cioMsgs: [m],
      };
    }
  }
  if (current) turns.push(current);
  return turns;
}

/** Palettes couleur cycliques par tour (5 palettes). */
const PALETTES = [
  {
    wrap:       "bg-violet-50/70 border-violet-200",
    badge:      "bg-violet-600 text-white",
    labelText:  "text-violet-700",
    userBg:     "bg-violet-700 text-white",
    userMeta:   "text-violet-200",
    cioBorder:  "border-l-violet-300",
    cioMeta:    "text-violet-500",
    line:       "border-violet-100",
    count:      "bg-violet-100 text-violet-600",
  },
  {
    wrap:       "bg-blue-50/70 border-blue-200",
    badge:      "bg-blue-600 text-white",
    labelText:  "text-blue-700",
    userBg:     "bg-blue-700 text-white",
    userMeta:   "text-blue-200",
    cioBorder:  "border-l-blue-300",
    cioMeta:    "text-blue-500",
    line:       "border-blue-100",
    count:      "bg-blue-100 text-blue-600",
  },
  {
    wrap:       "bg-emerald-50/70 border-emerald-200",
    badge:      "bg-emerald-600 text-white",
    labelText:  "text-emerald-700",
    userBg:     "bg-emerald-700 text-white",
    userMeta:   "text-emerald-200",
    cioBorder:  "border-l-emerald-300",
    cioMeta:    "text-emerald-600",
    line:       "border-emerald-100",
    count:      "bg-emerald-100 text-emerald-600",
  },
  {
    wrap:       "bg-amber-50/70 border-amber-200",
    badge:      "bg-amber-500 text-white",
    labelText:  "text-amber-700",
    userBg:     "bg-amber-600 text-white",
    userMeta:   "text-amber-100",
    cioBorder:  "border-l-amber-300",
    cioMeta:    "text-amber-600",
    line:       "border-amber-100",
    count:      "bg-amber-100 text-amber-600",
  },
  {
    wrap:       "bg-rose-50/70 border-rose-200",
    badge:      "bg-rose-600 text-white",
    labelText:  "text-rose-700",
    userBg:     "bg-rose-700 text-white",
    userMeta:   "text-rose-200",
    cioBorder:  "border-l-rose-300",
    cioMeta:    "text-rose-600",
    line:       "border-rose-100",
    count:      "bg-rose-100 text-rose-600",
  },
] as const;

function turnLabel(turnIdx: number): string {
  if (turnIdx === 0) return "Mission initiale";
  return `Échange ${turnIdx + 1}`;
}

function turnIcon(turnIdx: number): string {
  if (turnIdx === 0) return "🎯";
  return "↩";
}

export default function SessionCadrageTimeline({
  messages,
  title = "Fil de cadrage avec le CIO",
  className = "",
  maxHeightClass = "max-h-[min(32rem,60vh)]",
}: Props) {
  const list = Array.isArray(messages) ? (messages as Msg[]) : [];
  const turns = groupIntoTurns(list);
  const [readerOpen, setReaderOpen] = useState(false);

  // Id du tour déroulé (null = tous repliés sauf le dernier)
  const [openTurnId, setOpenTurnId] = useState<string | null>(null);

  if (turns.length === 0) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${className}`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <p className="mt-2 text-xs text-slate-500">Aucun échange enregistré pour cette mission.</p>
      </div>
    );
  }

  const lastTurnIdx = turns.length - 1;

  return (
    <>
      {readerOpen ? <div className="fixed inset-0 z-40 bg-slate-950/45" onClick={() => setReaderOpen(false)} /> : null}
      <div
        className={`rounded-xl border border-slate-200 bg-white ${
          readerOpen ? "fixed inset-4 z-50 flex flex-col shadow-2xl" : ""
        } ${className}`}
      >
      {/* En-tête */}
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {turns.length} tour{turns.length > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => setReaderOpen((v) => !v)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            {readerOpen ? "Réduire" : "Agrandir"}
          </button>
        </div>
      </div>

      {/* Navigation rapide par tour */}
      {turns.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-3 py-2">
          {turns.map((t) => {
            const p = PALETTES[t.idx % PALETTES.length];
            const isOpen = openTurnId === t.id || (openTurnId === null && t.idx === lastTurnIdx);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setOpenTurnId(isOpen ? null : t.id)}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  isOpen ? p.badge : p.count
                }`}
              >
                {turnIcon(t.idx)} {turnLabel(t.idx)}
              </button>
            );
          })}
        </div>
      )}

      {/* Corps : liste des tours */}
      <div className={`space-y-2 overflow-y-auto px-3 py-3 ${readerOpen ? "flex-1 min-h-0" : maxHeightClass}`}>
        {turns.map((turn) => {
          const p = PALETTES[turn.idx % PALETTES.length];
          const isLast = turn.idx === lastTurnIdx;
          const isOpen = openTurnId === turn.id || (openTurnId === null && isLast);
          // Pour les tours non-courants, afficher seulement un aperçu replié
          const preview = turn.userMsg?.content
            ? String(turn.userMsg.content).slice(0, 120) + (String(turn.userMsg.content).length > 120 ? "…" : "")
            : null;

          return (
            <div
              key={turn.id}
              className={`overflow-hidden rounded-xl border ${p.wrap} transition-all`}
            >
              {/* En-tête du tour — toujours visible, cliquable */}
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                onClick={() => setOpenTurnId(isOpen ? null : turn.id)}
              >
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${p.badge}`}>
                  {turnIcon(turn.idx)} {turnLabel(turn.idx)}
                </span>
                {!isOpen && preview && (
                  <span className={`flex-1 truncate text-[11px] ${p.labelText}`}>{preview}</span>
                )}
                {turn.cioMsgs.length > 0 && (
                  <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${p.count}`}>
                    {turn.cioMsgs.length} rép.
                  </span>
                )}
                <span className={`text-[10px] ${p.labelText} transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
              </button>

              {/* Corps du tour — visible seulement si ouvert */}
              {isOpen && (
                <div className={`space-y-2 border-t px-3 pb-3 pt-2 ${p.line}`}>
                  {/* Message utilisateur */}
                  {turn.userMsg && (
                    <div className="flex justify-end">
                      <div className={`max-w-[90%] rounded-2xl px-3 py-2 ${p.userBg}`}>
                        <p className={`mb-1 font-mono text-[9px] ${p.userMeta}`}>
                          {formatEventTs(turn.userMsg.ts)} · vous
                        </p>
                        <p className={`whitespace-pre-wrap leading-relaxed ${readerOpen ? "text-[15px]" : "text-[12px]"}`}>
                          {String(turn.userMsg.content || "")}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Réponses CIO / agents */}
                  {turn.cioMsgs.map((m, mi) => {
                    const agent = m.agent ? String(m.agent) : "CIO";
                    return (
                      <div key={`${m.ts || ""}-${mi}`} className="flex justify-start">
                        <div className={`max-w-[90%] rounded-2xl border-l-4 bg-white px-3 py-2 shadow-sm ${p.cioBorder}`}>
                          <p className={`mb-1 font-mono text-[9px] ${p.cioMeta}`}>
                            {formatEventTs(m.ts)}
                            {" · "}
                            <span className="font-semibold">{agent}</span>
                          </p>
                          <AgentMessageMarkdown
                            source={String(m.content || "")}
                            className={
                              readerOpen
                                ? "text-[15px] leading-relaxed text-slate-800 [&_h1]:text-[16px] [&_h1]:font-bold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:text-[14px] [&_p]:text-[15px] [&_ul]:my-2 [&_ol]:my-2"
                                : "text-[12px] leading-relaxed text-slate-800 [&_h1]:text-[12px] [&_h1]:font-bold [&_h2]:text-[11px] [&_h2]:font-semibold [&_h3]:text-[11px] [&_h3]:font-semibold [&_li]:text-[11px] [&_p]:text-[12px] [&_ul]:my-1 [&_ol]:my-1"
                            }
                          />
                        </div>
                      </div>
                    );
                  })}

                  {turn.cioMsgs.length === 0 && (
                    <p className={`text-[11px] italic ${p.labelText} opacity-60`}>
                      Réponse CIO en attente…
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </>
  );
}
