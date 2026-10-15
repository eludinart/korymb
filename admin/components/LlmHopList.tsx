"use client";

import { useEffect, useState } from "react";
import { requestJson } from "../lib/api";

export type PoolHop = {
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

export function shortModel(model: string | null | undefined): string {
  if (!model) return "";
  return model.split("/").pop() || model;
}

type PoolState = {
  hops: PoolHop[];
  prefer: string;
  provider: string;
  model: string;
  loading: boolean;
  error: string;
  savingId: string | null;
  choose: (hopId: string) => Promise<boolean>;
};

function useLlmPool(): PoolState {
  const [hops, setHops] = useState<PoolHop[]>([]);
  const [prefer, setPrefer] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const apply = (data: {
    provider?: unknown;
    model?: unknown;
    free_pool?: { hops?: PoolHop[]; prefer_hop_id?: string };
  }) => {
    const pool = data?.free_pool;
    setHops(Array.isArray(pool?.hops) ? pool.hops : []);
    setPrefer(String(pool?.prefer_hop_id || ""));
    setProvider(data?.provider != null ? String(data.provider) : "");
    setModel(data?.model != null ? String(data.model) : "");
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void requestJson("/llm", { retries: 0, timeoutMs: 8_000 })
      .then(({ data }) => {
        if (!cancelled) apply(data || {});
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
  }, []);

  async function choose(hopId: string): Promise<boolean> {
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
        return false;
      }
      setPrefer(hopId);
      try {
        const refreshed = await requestJson("/llm", { retries: 0, timeoutMs: 8_000 });
        apply(refreshed.data || {});
      } catch {
        /* le choix est enregistré ; le libellé se mettra à jour au prochain passage */
      }
      return true;
    } catch {
      setError("Enregistrement impossible.");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  return { hops, prefer, provider, model, loading, error, savingId, choose };
}

function HopChoice({
  selected,
  busy,
  title,
  detail,
  badge,
  badgePaid,
  touch,
  onChoose,
}: {
  selected: boolean;
  busy: boolean;
  title: string;
  detail: string;
  badge?: string;
  badgePaid?: boolean;
  touch?: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={busy}
      onClick={onChoose}
      className={`block w-full rounded-lg text-left hover:bg-violet-50 disabled:opacity-60 dark:hover:bg-violet-950 ${
        touch ? "min-h-11 px-2.5 py-2" : "px-2 py-1.5"
      } ${selected ? "bg-violet-50 dark:bg-violet-950" : ""}`}
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

function HopChoices({
  pool,
  touch,
  onChosen,
  listClassName = "max-h-80",
}: {
  pool: PoolState;
  touch?: boolean;
  onChosen?: () => void;
  listClassName?: string;
}) {
  const pick = (hopId: string) => {
    void pool.choose(hopId).then((ok) => {
      if (ok) onChosen?.();
    });
  };

  return (
    <>
      <p className="px-2 pt-1 text-xs font-semibold text-slate-900 dark:text-slate-100">Modèle de départ</p>
      <p className="px-2 pb-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        S&apos;il refuse ou sature, le suivant de la liste prend le relais.
      </p>
      {pool.loading ? <p className="px-2 py-2 text-xs text-slate-500">Chargement…</p> : null}
      {pool.error ? <p className="px-2 py-1 text-xs text-red-700 dark:text-red-300">{pool.error}</p> : null}
      <div role="listbox" aria-label="Modèles du mélange" className={`${listClassName} space-y-1 overflow-auto`}>
        <HopChoice
          selected={!pool.prefer}
          busy={pool.savingId === ""}
          title="Automatique"
          detail="Gratuit d'abord, du plus léger au secours"
          touch={touch}
          onChoose={() => pick("")}
        />
        {pool.hops.map((hop) => (
          <HopChoice
            key={hop.id}
            selected={pool.prefer === hop.id}
            busy={pool.savingId === hop.id}
            title={shortModel(hop.model)}
            badge={hop.billing === "payant" ? "Payant" : "Gratuit"}
            badgePaid={hop.billing === "payant"}
            detail={[ROLE_LABEL[hop.role] || hop.role, hop.provider, hop.quota].filter(Boolean).join(" · ")}
            touch={touch}
            onChoose={() => pick(hop.id)}
          />
        ))}
        {!pool.loading && pool.hops.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-500">
            Aucun seau dans le mélange. Réglez les clés dans Administration → LLM.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Liste du mélange, chargée à l'affichage. Même choix que le bandeau. */
export default function LlmHopList({ touch, onChosen }: { touch?: boolean; onChosen?: () => void }) {
  const pool = useLlmPool();
  return <HopChoices pool={pool} touch={touch} onChosen={onChosen} />;
}

/** Bloc repliable pour le tiroir du chat : libellé du modèle actif, puis la même liste. */
export function LlmModelSection() {
  const pool = useLlmPool();
  const [open, setOpen] = useState(false);
  const provider = pool.provider ? pool.provider.toUpperCase() : "";
  const model = shortModel(pool.model);
  const current = [provider, model].filter(Boolean).join(" / ");

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Modèle
        </span>
        <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] font-semibold text-violet-800 dark:text-violet-200">
          <span className="truncate">{pool.loading && !current ? "Chargement…" : current || "Choisir"}</span>
          <span aria-hidden className="shrink-0 text-[10px] text-slate-400">
            {open ? "▴" : "▾"}
          </span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-200 px-1 pb-2 dark:border-slate-700">
          <HopChoices pool={pool} touch listClassName="max-h-48" onChosen={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
