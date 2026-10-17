"use client";

import { useEffect, useRef, useState } from "react";
import { agentHeaders, apiUrl, formatHttpApiErrorPayload } from "../../lib/api";
import CorimbeOrb from "./CorimbeOrb";
import type { OrbMood } from "../../lib/chatProgress";

type SpeechResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
};

type SpeechErrorEvent = { error?: string };

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type Phase = "listening" | "thinking" | "speaking" | "blocked";

const PHASE_LINE: Record<Phase, string> = {
  listening: "Je vous écoute.",
  thinking: "Korymb réfléchit.",
  speaking: "Korymb vous répond.",
  blocked: "La conversation vocale est indisponible.",
};

const PHASE_MOOD: Record<Phase, OrbMood> = {
  listening: "searching",
  thinking: "writing",
  speaking: "speaking",
  blocked: "waiting",
};

function speechCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return host.SpeechRecognition || host.webkitSpeechRecognition || null;
}

/** Texte dit à voix haute : phrases, sans balises. */
export function speechPlain(raw: string): string {
  const clean = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_>~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= 900) return clean;
  const cut = clean.slice(0, 900);
  const end = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?"),
  );
  return (end > 240 ? cut.slice(0, end + 1) : cut).trim();
}

function listenOnce(
  rec: BrowserSpeechRecognition,
  onLive: (text: string) => void,
  onBlocked: (message: string) => void,
): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    let finalText = "";
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value.trim());
    };
    rec.lang = "fr-FR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const row = event.results[i];
        const bit = row?.[0]?.transcript || "";
        if (row?.isFinal) finalText += bit;
        else interim += bit;
      }
      onLive(`${finalText}${interim}`.trim());
    };
    rec.onerror = (event) => {
      const code = event.error || "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        onBlocked("Autorisez le micro pour parler avec Korymb.");
      } else if (code === "audio-capture") {
        onBlocked("Aucun micro n'est disponible.");
      } else if (code === "network") {
        onBlocked("La reconnaissance vocale a besoin du réseau.");
      }
      if (code !== "no-speech" && code !== "aborted") finish("");
    };
    rec.onend = () => finish(finalText);
    try {
      rec.start();
    } catch {
      onBlocked("La conversation vocale n'a pas démarré.");
      finish("");
    }
  });
}

type VoiceActivity = {
  label: string;
  steps?: string[];
};

type FeedLine = {
  id: number;
  turn: number;
  kind: "you" | "work" | "draft";
  text: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onUtterance: (text: string) => Promise<string>;
  /** Ce que Korymb fait pendant que la réponse se prépare. */
  activity?: VoiceActivity | null;
  /** Texte déjà écrit par Korymb pour le tour en cours. */
  workText?: string;
};

function activityLines(activity: VoiceActivity | null | undefined): string[] {
  const steps = (activity?.steps || [])
    .map((step) => step.trim())
    .filter(Boolean);
  const label = (activity?.label || "").trim();
  if (label && steps[steps.length - 1] !== label) steps.push(label);
  return steps;
}

/** Aller-retour vocal : l'utilisateur parle, Korymb répond à voix haute, puis réécoute. */
export default function ChatVoiceConversation({
  open,
  onClose,
  onUtterance,
  activity = null,
  workText = "",
}: Props) {
  const [phase, setPhase] = useState<Phase>("listening");
  const [line, setLine] = useState(PHASE_LINE.listening);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const onUtteranceRef = useRef(onUtterance);
  const workTextRef = useRef(workText);
  const settledWorkRef = useRef("");
  const turnRef = useRef(0);
  const feedIdRef = useRef(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const stopPlaybackRef = useRef<(() => void) | null>(null);
  onUtteranceRef.current = onUtterance;
  workTextRef.current = workText;

  function stopSpoken() {
    stopPlaybackRef.current?.();
  }

  function speakKorymb(text: string, cancelled: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const ac = new AbortController();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      stopPlaybackRef.current = () => {
        ac.abort();
        const audio = playbackRef.current;
        if (audio) {
          audio.pause();
          audio.src = "";
        }
        finish();
      };
      void (async () => {
        try {
          const res = await fetch(apiUrl("/chat/voice"), {
            method: "POST",
            headers: agentHeaders(),
            credentials: "same-origin",
            body: JSON.stringify({ text }),
            signal: ac.signal,
          });
          if (cancelled() || ac.signal.aborted) {
            finish();
            return;
          }
          if (!res.ok) {
            let detail = "La voix n'a pas pu être générée.";
            try {
              detail = formatHttpApiErrorPayload(await res.json()) || detail;
            } catch {
              detail = detail;
            }
            fail(new Error(detail));
            return;
          }
          const blob = await res.blob();
          if (cancelled() || ac.signal.aborted) {
            finish();
            return;
          }
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          playbackRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            finish();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            fail(new Error("La lecture a échoué."));
          };
          await audio.play();
        } catch (error) {
          if (cancelled() || ac.signal.aborted) finish();
          else
            fail(
              error instanceof Error
                ? error
                : new Error("La voix n'a pas pu être générée."),
            );
        }
      })();
    });
  }

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const Ctor = speechCtor();
    const rec = Ctor ? new Ctor() : null;
    const cancelled = () => stopped;

    const run = async () => {
      if (!rec) {
        setPhase("blocked");
        setLine("Ce navigateur ne propose pas la reconnaissance vocale.");
        return;
      }
      const putLine = (turn: number, kind: FeedLine["kind"], text: string) => {
        const clean = text.trim();
        if (!clean) return;
        setFeed((prev) => {
          const idx = prev.findIndex(
            (row) => row.turn === turn && row.kind === kind,
          );
          if (idx === -1)
            return [
              ...prev,
              { id: feedIdRef.current++, turn, kind, text: clean },
            ];
          if (prev[idx].text === clean) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx], text: clean };
          return next;
        });
      };

      while (!stopped) {
        setPhase("listening");
        setLine(PHASE_LINE.listening);
        turnRef.current += 1;
        const turn = turnRef.current;
        let blocked = false;
        const heard = await listenOnce(
          rec,
          (text) => {
            if (!stopped) putLine(turn, "you", text);
          },
          (message) => {
            blocked = true;
            if (!stopped) {
              setPhase("blocked");
              setLine(message);
            }
          },
        );
        if (stopped || blocked) return;
        if (!heard) {
          await new Promise((resolve) => window.setTimeout(resolve, 300));
          continue;
        }
        putLine(turn, "you", heard);
        settledWorkRef.current = workTextRef.current.trim();
        setPhase("thinking");
        setLine(PHASE_LINE.thinking);
        let reply = "";
        try {
          reply = speechPlain(await onUtteranceRef.current(heard));
        } catch {
          reply = "";
        }
        if (stopped) return;
        if (!reply) {
          setLine("Je n'ai pas de réponse à dire. Je vous réécoute.");
          continue;
        }
        setPhase("speaking");
        setLine(PHASE_LINE.speaking);
        putLine(turn, "draft", reply);
        try {
          await speakKorymb(reply, cancelled);
        } catch (error) {
          if (stopped) return;
          setPhase("blocked");
          setLine(
            error instanceof Error
              ? error.message
              : "La voix n'a pas pu être générée.",
          );
          return;
        }
      }
    };

    void run();
    return () => {
      stopped = true;
      rec?.abort();
      stopPlaybackRef.current?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || (phase !== "thinking" && phase !== "speaking")) return;
    const turn = turnRef.current;
    const incoming = activityLines(activity);
    if (!incoming.length) return;
    setFeed((prev) => {
      const known = new Set(
        prev
          .filter((row) => row.kind === "work" && row.turn === turn)
          .map((row) => row.text),
      );
      const extra = incoming
        .filter((text) => !known.has(text))
        .map((text) => ({
          id: feedIdRef.current++,
          turn,
          kind: "work" as const,
          text,
        }));
      return extra.length ? [...prev, ...extra] : prev;
    });
  }, [open, phase, activity]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [feed, phase, workText]);

  if (!open) return null;

  const produced = workText.trim();
  const liveWork =
    (phase === "thinking" || phase === "speaking") && produced ? produced : "";
  const rows = liveWork ? feed.filter((row) => row.kind !== "draft") : feed;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-white">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
        <p className="text-sm font-semibold">Conversation</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-white/90 dark:hover:bg-white/10"
        >
          Terminer
        </button>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2 px-6 pt-2 text-center">
        <CorimbeOrb mood={PHASE_MOOD[phase]} size="lg" />
        <p className="text-sm font-semibold" role="status">
          {line}
        </p>
      </div>
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 pb-2"
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-2 text-left">
          {rows.map((row, index) => {
            const previous = rows[index - 1];
            const korymbHead =
              row.kind !== "you" && (!previous || previous.kind === "you");
            if (row.kind === "you") {
              return (
                <div key={row.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Vous
                  </p>
                  <p className="mt-1 text-base leading-6">{row.text}</p>
                </div>
              );
            }
            return (
              <div key={row.id}>
                {korymbHead ? (
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                    Korymb
                  </p>
                ) : null}
                <p
                  className={`${korymbHead ? "mt-1 " : ""}text-sm leading-5 text-violet-800 dark:text-violet-200`}
                >
                  {row.text}
                </p>
              </div>
            );
          })}
          {liveWork ? (
            <div>
              {rows[rows.length - 1]?.kind === "you" || rows.length === 0 ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  Korymb
                </p>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">
                {liveWork}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      {phase === "speaking" ? (
        <div className="shrink-0 px-4 pb-6">
          <button
            type="button"
            onClick={stopSpoken}
            className="mx-auto block rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 dark:border-white/30 dark:text-white"
          >
            Je parle
          </button>
        </div>
      ) : (
        <div className="h-16 shrink-0" />
      )}
    </div>
  );
}
