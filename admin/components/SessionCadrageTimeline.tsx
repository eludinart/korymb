"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import { extractCioStrategicQuestions } from "../lib/missionBilan";
import { enrichCadrageThreadContent, isThreadContentLikelyTruncated } from "../lib/missionThreadEnrich";
import { formatEventTs } from "../lib/missionEvents";

type Msg = { role?: string; content?: string; ts?: string; agent?: string };

type Props = {
  messages: unknown;
  title?: string;
  className?: string;
  maxHeightClass?: string;
  /** Colonne latérale : hauteur remplie par le parent, bandeau + onglets fixes, un seul tour défile. */
  fillColumn?: boolean;
  /** Section « questions stratégiques » (résultat CIO complet) ; sinon détection sur la fin du fil. */
  cioStrategicFollowup?: string | null;
  /** Plan mission (sous_taches) pour reconstituer les consignes CIO tronquées dans le fil archivé. */
  missionPlan?: unknown;
  /** Consigne mission complète (texte initial) — affichée en tête du fil si plus riche que le 1er message user. */
  missionBrief?: string | null;
  /** Zone fixe sous le fil (ex. « Discuter avec le CIO »). */
  footer?: ReactNode;
};

/** Un "tour" = un message utilisateur + toutes les réponses CIO qui suivent. */
type Turn = {
  id: string;
  idx: number;
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
    const role = String(m.role ?? "?").trim();
    const roleLc = role.toLowerCase();
    if (roleLc === "user") {
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

const PALETTES = [
  {
    wrap: "bg-violet-50/70 border-violet-200",
    badge: "bg-violet-600 text-white",
    labelText: "text-violet-700",
    userBg: "bg-violet-700 text-white",
    userMeta: "text-violet-200",
    cioBorder: "border-l-violet-300",
    cioMeta: "text-violet-500",
    line: "border-violet-100",
    count: "bg-violet-100 text-violet-600",
  },
  {
    wrap: "bg-blue-50/70 border-blue-200",
    badge: "bg-blue-600 text-white",
    labelText: "text-blue-700",
    userBg: "bg-blue-700 text-white",
    userMeta: "text-blue-200",
    cioBorder: "border-l-blue-300",
    cioMeta: "text-blue-500",
    line: "border-blue-100",
    count: "bg-blue-100 text-blue-600",
  },
  {
    wrap: "bg-emerald-50/70 border-emerald-200",
    badge: "bg-emerald-600 text-white",
    labelText: "text-emerald-700",
    userBg: "bg-emerald-700 text-white",
    userMeta: "text-emerald-200",
    cioBorder: "border-l-emerald-300",
    cioMeta: "text-emerald-600",
    line: "border-emerald-100",
    count: "bg-emerald-100 text-emerald-600",
  },
  {
    wrap: "bg-amber-50/70 border-amber-200",
    badge: "bg-amber-500 text-white",
    labelText: "text-amber-700",
    userBg: "bg-amber-600 text-white",
    userMeta: "text-amber-100",
    cioBorder: "border-l-amber-300",
    cioMeta: "text-amber-600",
    line: "border-amber-100",
    count: "bg-amber-100 text-amber-600",
  },
  {
    wrap: "bg-rose-50/70 border-rose-200",
    badge: "bg-rose-600 text-white",
    labelText: "text-rose-700",
    userBg: "bg-rose-700 text-white",
    userMeta: "text-rose-200",
    cioBorder: "border-l-rose-300",
    cioMeta: "text-rose-600",
    line: "border-rose-100",
    count: "bg-rose-100 text-rose-600",
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

function TruncationNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-950 ${className}`}>
      Extrait limité dans le fil (10 000 car. max.). Texte intégral de l&apos;agent : onglet{" "}
      <span className="font-semibold">Synthèse &amp; livrables</span>.
    </p>
  );
}

function renderCioMessage(
  m: Msg,
  mi: number,
  p: (typeof PALETTES)[number],
  expandedTypography: boolean,
  missionPlan: unknown,
) {
  const agent = m.agent ? String(m.agent) : "CIO";
  const enriched = enrichCadrageThreadContent(String(m.content || ""), missionPlan);
  const truncated = isThreadContentLikelyTruncated(enriched.text);
  return (
    <div key={`${m.ts || ""}-${mi}`} className="flex justify-start">
      <div className={`max-w-[95%] rounded-2xl border-l-4 bg-white px-3 py-2 shadow-sm ${p.cioBorder}`}>
        <p className={`mb-1 font-mono text-[9px] ${p.cioMeta}`}>
          {formatEventTs(m.ts)}
          {" · "}
          <span className="font-semibold">{agent}</span>
          {enriched.wasEnriched ? (
            <span className="ml-1.5 rounded bg-emerald-100 px-1 py-px text-[8px] font-semibold uppercase text-emerald-800">
              consigne complète
            </span>
          ) : null}
        </p>
        {truncated ? <TruncationNotice className="mb-2" /> : null}
        <AgentMessageMarkdown
          source={enriched.text}
          className={
            expandedTypography
              ? "text-[15px] leading-relaxed text-slate-800 [&_h1]:text-[16px] [&_h1]:font-bold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-[14px] [&_h3]:font-semibold [&_li]:text-[14px] [&_p]:text-[15px] [&_ul]:my-2 [&_ol]:my-2"
              : "text-[12px] leading-relaxed text-slate-800 [&_h1]:text-[12px] [&_h1]:font-bold [&_h2]:text-[11px] [&_h2]:font-semibold [&_h3]:text-[11px] [&_h3]:font-semibold [&_li]:text-[11px] [&_p]:text-[12px] [&_ul]:my-1 [&_ol]:my-1"
          }
        />
      </div>
    </div>
  );
}

function userTurnContent(turn: Turn, missionBrief: string | null): string {
  const user = String(turn.userMsg?.content || "").trim();
  const brief = String(missionBrief || "").trim();
  if (turn.idx === 0 && brief.length > user.length + 120) return brief;
  return user;
}

function renderTurnMessages(
  turn: Turn,
  expandedTypography: boolean,
  missionPlan: unknown,
  showTurnHeading: boolean,
  missionBrief: string | null,
) {
  const p = PALETTES[turn.idx % PALETTES.length];
  return (
    <div className={`space-y-2 rounded-xl border px-3 pb-3 pt-3 ${p.wrap} ${p.line}`}>
      {showTurnHeading ? (
        <p className={`text-[10px] font-bold uppercase tracking-wide ${p.labelText}`}>
          {turnIcon(turn.idx)} {turnLabel(turn.idx)}
          <span className="ml-1.5 font-normal normal-case text-slate-500">
            · {turn.cioMsgs.length} msg. CIO
            {turn.userMsg ? " · consigne dirigeant" : ""}
          </span>
        </p>
      ) : null}
      {turn.userMsg ? (
        <div className="flex justify-end">
          <div className={`max-w-[95%] rounded-2xl px-3 py-2 ${p.userBg}`}>
            <p className={`mb-1 font-mono text-[9px] ${p.userMeta}`}>
              {formatEventTs(turn.userMsg.ts)} · vous
              {turn.idx === 0 &&
              String(missionBrief || "").trim().length >
                String(turn.userMsg.content || "").length + 120 ? (
                <span className="ml-1.5 rounded bg-white/20 px-1 py-px text-[8px] font-semibold uppercase">
                  consigne complète
                </span>
              ) : null}
            </p>
            <p
              className={`whitespace-pre-wrap leading-relaxed ${expandedTypography ? "text-[15px]" : "text-[12px]"}`}
            >
              {userTurnContent(turn, missionBrief)}
            </p>
          </div>
        </div>
      ) : null}

      {turn.cioMsgs.map((m, mi) => renderCioMessage(m, mi, p, expandedTypography, missionPlan))}

      {turn.cioMsgs.length === 0 ? (
        <div className={`space-y-1 rounded-lg border border-dashed px-2.5 py-2 ${p.line} bg-white/50`}>
          <p className={`text-[11px] font-medium italic ${p.labelText}`}>Réponse CIO en attente dans le fil</p>
          <p className="text-[10px] leading-snug text-slate-600">
            Aucune réponse enregistrée pour cette relance. Utilisez le champ{" "}
            <span className="font-semibold">« Discuter avec le CIO »</span> sous le fil pour continuer la mission.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function SessionCadrageTimeline({
  messages,
  title = "Fil de cadrage avec le CIO",
  className = "",
  maxHeightClass = "max-h-[min(32rem,60vh)]",
  fillColumn = false,
  cioStrategicFollowup = null,
  missionPlan = null,
  missionBrief = null,
  footer = null,
}: Props) {
  const list = useMemo(() => (Array.isArray(messages) ? (messages as Msg[]) : []), [messages]);
  const turns = useMemo(() => groupIntoTurns(list), [list]);

  const strategicFromThread = useMemo(() => {
    const tail = list
      .slice(-20)
      .map((m) => String((m as Msg).content || ""))
      .join("\n\n");
    return extractCioStrategicQuestions(tail);
  }, [list]);

  const strategicBody =
    (cioStrategicFollowup?.trim().length ?? 0) > 10
      ? cioStrategicFollowup!.trim()
      : strategicFromThread;

  const [readerOpen, setReaderOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"turn" | "full">("turn");
  const [briefOpen, setBriefOpen] = useState(true);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const prevTurnCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastTurnId = turns[turns.length - 1]?.id ?? null;
  const effectiveTurnId =
    selectedTurnId && turns.some((t) => t.id === selectedTurnId) ? selectedTurnId : lastTurnId;
  const activeTurn = turns.find((t) => t.id === effectiveTurnId) ?? turns[turns.length - 1];

  const briefText = String(missionBrief || "").trim();
  const briefRicherThanThread =
    briefText.length > 200 &&
    (!turns[0]?.userMsg || briefText.length > String(turns[0].userMsg.content || "").length + 120);
  const inlineBriefInActiveTurn =
    viewMode === "turn" && activeTurn?.idx === 0 && briefRicherThanThread;
  const showMissionBrief = briefRicherThanThread && !inlineBriefInActiveTurn;

  useEffect(() => {
    if (!lastTurnId) return;
    const n = turns.length;
    const grew = n > prevTurnCountRef.current;
    prevTurnCountRef.current = n;
    setSelectedTurnId((prev) => {
      if (!prev || !turns.some((t) => t.id === prev)) return lastTurnId;
      if (grew) return lastTurnId;
      return prev;
    });
  }, [lastTurnId, turns]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [effectiveTurnId, viewMode]);

  useEffect(() => {
    if (!readerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [readerOpen]);

  if (turns.length === 0) {
    return (
      <div
        className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${fillColumn ? "flex min-h-0 flex-1 flex-col" : ""} ${className}`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <p className="mt-2 text-xs text-slate-500">Aucun échange enregistré pour cette mission.</p>
      </div>
    );
  }

  const expandedTypography = readerOpen;
  const outerFlex = fillColumn || readerOpen;
  const panelRootClass = outerFlex
    ? "flex min-h-0 flex-1 flex-col overflow-hidden"
    : "flex flex-col overflow-hidden";

  const renderPanelInner = () => (
    <div className={panelRootClass}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {turns.length} tour{turns.length > 1 ? "s" : ""} · {list.length} msg.
          </span>
          {turns.length > 1 ? (
            <button
              type="button"
              onClick={() => setViewMode((m) => (m === "turn" ? "full" : "turn"))}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                viewMode === "full"
                  ? "border-violet-300 bg-violet-50 text-violet-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {viewMode === "full" ? "Par échange" : "Fil complet"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setReaderOpen((v) => !v)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            {readerOpen ? "Réduire" : "Agrandir"}
          </button>
        </div>
      </div>

      {viewMode === "turn" && turns.length > 1 ? (
        <div
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 px-2 py-2"
          role="tablist"
          aria-label="Choisir un échange du fil"
        >
          {turns.map((turn) => {
            const p = PALETTES[turn.idx % PALETTES.length];
            const selected = turn.id === effectiveTurnId;
            return (
              <button
                key={turn.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSelectedTurnId(turn.id)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-left text-[10px] font-semibold transition-colors ${
                  selected
                    ? `${p.badge} border-transparent shadow-sm`
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className="whitespace-nowrap">
                  {turnIcon(turn.idx)} {turnLabel(turn.idx)}
                  {turn.cioMsgs.length > 0 ? (
                    <span className={`ml-1 font-medium tabular-nums ${selected ? "text-white/90" : "text-slate-400"}`}>
                      · {turn.cioMsgs.length}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className={
          outerFlex
            ? "min-h-[10rem] min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 pb-12"
            : `min-h-[8rem] overflow-y-auto overflow-x-hidden px-3 py-3 pb-10 ${maxHeightClass}`
        }
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Messages du fil — faites défiler
        </p>
        {showMissionBrief ? (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/90">
            <button
              type="button"
              onClick={() => setBriefOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600"
            >
              <span>Consigne mission complète</span>
              <span className="text-slate-400">{briefOpen ? "▲" : "▼"}</span>
            </button>
            {briefOpen ? (
              <div className="max-h-[min(40vh,20rem)] overflow-y-auto border-t border-slate-200 px-3 py-3">
                <AgentMessageMarkdown
                  source={briefText}
                  className="text-[12px] leading-relaxed text-slate-800 [&_p]:text-[12px]"
                />
              </div>
            ) : (
              <p className="border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500">
                Le fil ne reprend que les relances chat ; ouvrez pour le texte initial intégral ({briefText.length}{" "}
                car.).
              </p>
            )}
          </div>
        ) : null}

        {viewMode === "full" ? (
          <div className="space-y-4">
            {turns.map((turn) => (
              <div key={turn.id}>
                {renderTurnMessages(turn, expandedTypography, missionPlan, true, missionBrief)}
              </div>
            ))}
          </div>
        ) : activeTurn ? (
          renderTurnMessages(activeTurn, expandedTypography, missionPlan, false, missionBrief)
        ) : null}

        {(viewMode === "full" || (activeTurn && activeTurn.id === lastTurnId)) &&
        strategicBody &&
        strategicBody.length > 10 ? (
          <div className="mt-3 flex justify-start" role="article" aria-label="Suite du CIO après la réponse">
            <div className="max-w-[95%] rounded-2xl border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50/95 to-white px-3 py-2.5 shadow-sm ring-1 ring-emerald-100/70">
              <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-emerald-700">
                CIO · suite mission
              </p>
              <AgentMessageMarkdown
                source={strategicBody}
                className={
                  expandedTypography
                    ? "text-[14px] leading-relaxed text-emerald-950 [&_ol]:my-2 [&_li]:text-[14px] [&_p]:mb-1 [&_p]:text-[14px] [&_strong]:text-emerald-900"
                    : "text-[11px] leading-snug text-emerald-950 [&_ol]:my-1 [&_ol]:space-y-2 [&_li]:text-[11px] [&_li]:leading-relaxed [&_p]:mb-1 [&_p]:text-[11px] [&_strong]:text-emerald-900"
                }
              />
              <p className="mt-2 border-t border-emerald-100/80 pt-2 text-[9px] leading-snug text-emerald-700/90">
                Répondez ou affinez via la consigne ci-dessous (« Envoyer au CIO »).
              </p>
            </div>
          </div>
        ) : null}
      </div>
      {footer ? <div className="shrink-0 border-t border-slate-100">{footer}</div> : null}
    </div>
  );

  const shellClass = `rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col ${
    outerFlex ? "h-full min-h-0" : ""
  } ${fillColumn && !readerOpen ? "min-h-0 flex-1" : ""} ${className}`.trim();

  const expandedShellClass =
    "fixed inset-x-2 inset-y-4 z-[210] flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white pb-safe shadow-2xl sm:inset-4";

  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => setPortalMounted(true), []);

  const expandedOverlay =
    readerOpen && portalMounted && typeof document !== "undefined"
      ? createPortal(
          <>
            <div
              className="fixed inset-0 z-[200] bg-slate-950/50"
              aria-hidden
              onClick={() => setReaderOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${title} — vue agrandie`}
              className={expandedShellClass}
            >
              {renderPanelInner()}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      {!readerOpen ? (
        <div className={shellClass}>{renderPanelInner()}</div>
      ) : (
        <div className={`${shellClass} min-h-[14rem] shrink-0`} aria-hidden />
      )}
      {expandedOverlay}
    </>
  );
}
