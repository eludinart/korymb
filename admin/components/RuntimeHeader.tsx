"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "../lib/api";
import { useKorymbEventStream } from "../lib/korymbEvents";

function statusUi(status: "ok" | "warning" | "error") {
  if (status === "ok") return { dot: "bg-emerald-500", text: "Actif", textClass: "text-emerald-800 dark:text-emerald-300" };
  if (status === "error") return { dot: "bg-red-500", text: "Hors ligne", textClass: "text-red-800 dark:text-red-300" };
  return { dot: "bg-amber-500", text: "Sync…", textClass: "text-amber-800 dark:text-amber-300" };
}

function shortModel(model: string | null): string {
  if (!model) return "";
  return model.split("/").pop() || model;
}

type PoolHop = {
  id: string;
  provider: string;
  model: string;
  role: string;
  billing?: string;
  quota?: string;
  start?: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  courant: "Léger",
  médium: "Médium",
  expert: "Expert",
  secours: "Secours",
  garanti: "Dernier recours",
  configuré: "Configuré",
};

/** Mini-diagnostic LLM / DB / SSE. Le hook reste monté même si le bandeau est masqué. */
export default function RuntimeHeader({ visible = true }: { visible?: boolean }) {
  const { llm, db, status } = useKorymbEventStream();
  const [open, setOpen] = useState(false);
  const [hops, setHops] = useState<PoolHop[]>([]);
  const [prefer, setPrefer] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void requestJson("/llm", { retries: 0, timeoutMs: 8_000 })
      .then(({ data }) => {
        if (cancelled) return;
        const pool = data?.free_pool as { hops?: PoolHop[]; prefer_hop_id?: string } | undefined;
        setHops(Array.isArray(pool?.hops) ? pool.hops : []);
        setPrefer(String(pool?.prefer_hop_id || ""));
      })
      .catch(() => {
        if (!cancelled) setError("Liste des modèles indisponible.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!visible) return null;

  const ui = statusUi(status);
  const providerLabel = llm.provider ? llm.provider.toUpperCase() : "";
  const modelLabel = shortModel(llm.model);
  const modelFull = llm.model || "";
  const dbEnv = String(db.runtimeEnv || "").toLowerCase().includes("prod") ? "PROD" : "DEV";
  const dbEngine = db.engine ? db.engine.toUpperCase() : "";

  async function choose(hopId: string) {
    setSavingId(hopId);
    setError("");
    try {
      const response = await fetch("/api/korymb-admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm_prefer_hop_id: hopId }),
      });
      const data = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
      if (!response.ok) {
        setError(String(data.detail || data.error || `Enregistrement refusé (HTTP ${response.status}).`));
        return;
      }
      setPrefer(hopId);
      setOpen(false);
    } catch {
      setError("Enregistrement impossible.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div ref={boxRef} className="relative mt-0.5 max-w-[22rem]">
      <p
        className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] font-semibold text-slate-600 dark:text-slate-300"
        title={[ui.text, dbEngine && dbEnv ? `${dbEngine} ${dbEnv}` : "", providerLabel, modelFull]
          .filter(Boolean)
          .join(" · ")}
      >
        <span className={`inline-flex shrink-0 items-center gap-1 ${ui.textClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
          {ui.text}
        </span>
        {dbEngine ? (
          <>
            <span className="shrink-0 text-slate-300 dark:text-slate-600" aria-hidden>
              ·
            </span>
            <span className="shrink-0 font-mono text-[10px] text-slate-700 dark:text-slate-200">
              {dbEngine} {dbEnv}
            </span>
          </>
        ) : null}
        {providerLabel ? (
          <>
            <span className="shrink-0 text-slate-300 dark:text-slate-600" aria-hidden>
              ·
            </span>
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="listbox"
              onClick={() => setOpen((value) => !value)}
              className="min-w-0 truncate font-mono text-[10px] text-violet-800 underline-offset-2 hover:underline dark:text-violet-200"
            >
              {providerLabel}
              {modelLabel ? ` / ${modelLabel}` : ""}
            </button>
          </>
        ) : null}
      </p>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-white p-2 text-left shadow-xl dark:border-violet-900 dark:bg-slate-950">
          <p className="px-2 pt-1 text-xs font-semibold text-slate-900 dark:text-slate-100">Modèle de départ</p>
          <p className="px-2 pb-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            S&apos;il refuse ou sature, le suivant de la liste prend le relais.
          </p>
          {loading ? <p className="px-2 py-2 text-xs text-slate-500">Chargement…</p> : null}
          {error ? <p className="px-2 py-1 text-xs text-red-700 dark:text-red-300">{error}</p> : null}
          <div role="listbox" aria-label="Modèles du mélange" className="max-h-80 space-y-1 overflow-auto">
            <HopChoice
              selected={!prefer}
              busy={savingId === ""}
              title="Automatique"
              detail="Gratuit d'abord, du plus léger au secours"
              onChoose={() => void choose("")}
            />
            {hops.map((hop) => (
              <HopChoice
                key={hop.id}
                selected={prefer === hop.id}
                busy={savingId === hop.id}
                title={shortModel(hop.model)}
                badge={hop.billing === "payant" ? "Payant" : "Gratuit"}
                badgePaid={hop.billing === "payant"}
                detail={[ROLE_LABEL[hop.role] || hop.role, hop.provider, hop.quota].filter(Boolean).join(" · ")}
                onChoose={() => void choose(hop.id)}
              />
            ))}
            {!loading && hops.length === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-500">Aucun seau dans le mélange. Réglez les clés dans Administration → LLM.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HopChoice({
  selected,
  busy,
  title,
  detail,
  badge,
  badgePaid,
  onChoose,
}: {
  selected: boolean;
  busy: boolean;
  title: string;
  detail: string;
  badge?: string;
  badgePaid?: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={busy}
      onClick={onChoose}
      className={`block w-full rounded-lg px-2 py-1.5 text-left hover:bg-violet-50 disabled:opacity-60 dark:hover:bg-violet-950 ${
        selected ? "bg-violet-50 dark:bg-violet-950" : ""
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
          {busy ? "Enregistrement…" : title}
        </span>
        {badge ? (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              badgePaid
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            }`}
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">{detail}</span>
    </button>
  );
}
