"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import StarterPackPicker from "../../../components/StarterPackPicker";
import { PageHeader, StatCard } from "../../../components/ui/PageChrome";
import { formatHttpApiErrorPayload, requestJson } from "../../../lib/api";
import { FALLBACK_STARTER_PACKS, fetchStarterPacks, starterPackLabel, type StarterPackSummary } from "../../../lib/starterPacks";

type SpaceState = "calme" | "a_traiter" | "bloque" | "archive";

type SpaceCardData = {
  workspace_id: string;
  name: string;
  slug?: string;
  owner_email?: string;
  owner_name?: string;
  starter_pack_id?: string;
  archived_at?: string;
  protected?: boolean;
  paused?: boolean;
  exempt?: boolean;
  own_key?: boolean;
  tokens_used_month?: number;
  monthly_token_cap?: number;
  needs_you?: number;
  in_progress?: number;
  failures?: number;
  last_activity_at?: string;
  state?: SpaceState;
};

type AttentionItem = {
  workspace_id: string;
  workspace_name?: string;
  kind: string;
  kind_label: string;
  title: string;
  at?: string;
  open_path?: string;
};

const STATE_LABEL: Record<SpaceState, string> = {
  calme: "Calme",
  a_traiter: "À traiter",
  bloque: "Bloqué",
  archive: "Archivé",
};

const STATE_CLASS: Record<SpaceState, string> = {
  calme: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  a_traiter: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  bloque: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  archive: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1000) return `${Math.round(n / 1000)} k`;
  return String(n);
}

function fmtWhen(iso: string | undefined): string {
  const raw = (iso || "").trim();
  if (!raw) return "Aucune";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 16).replace("T", " ");
  return date.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function iaLabel(row: SpaceCardData): string {
  if (row.exempt) return "Hors enveloppe";
  if (row.own_key) return "Clé propre";
  return `${fmtTokens(row.tokens_used_month || 0)} / ${fmtTokens(row.monthly_token_cap || 0)}`;
}

async function openSpace(workspaceId: string, nextPath: "/briefing" | "/inbox") {
  const res = await fetch("/api/auth/switch-workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId, next: nextPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatHttpApiErrorPayload(data) || "Ouverture impossible.");
  }
  window.location.assign(String(data.redirect || nextPath));
}

function SpaceCard({ row }: { row: SpaceCardData }) {
  const qc = useQueryClient();
  const archived = row.state === "archive";
  const state = (row.state || "calme") as SpaceState;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["platform-portfolio"] }),
      qc.invalidateQueries({ queryKey: ["platform-attention"] }),
    ]);
  };

  const patch = useMutation({
    mutationFn: async (body: { name?: string; paused?: boolean }) => {
      const { data } = await requestJson(`/platform/workspaces/${encodeURIComponent(row.workspace_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return data as SpaceCardData;
    },
    onSuccess: async () => {
      setError("");
      setMessage("Enregistré.");
      setEditing(false);
      await refresh();
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message || "Enregistrement impossible.");
    },
  });

  const archive = useMutation({
    mutationFn: async (restore: boolean) => {
      const action = restore ? "restore" : "archive";
      const { data } = await requestJson(`/platform/workspaces/${encodeURIComponent(row.workspace_id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return data as SpaceCardData;
    },
    onSuccess: async (_data, restore) => {
      setError("");
      setMessage(restore ? "Espace réactivé." : "Espace archivé.");
      await refresh();
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message || "Action impossible.");
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson(`/platform/workspaces/${encodeURIComponent(row.workspace_id)}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_name: confirmName }),
      });
      return data;
    },
    onSuccess: async () => {
      setError("");
      setMessage("");
      setConfirmingDelete(false);
      await refresh();
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message || "Suppression impossible.");
    },
  });

  const busy = patch.isPending || archive.isPending || remove.isPending || opening;

  async function onOpen(nextPath: "/briefing" | "/inbox") {
    setOpening(true);
    setError("");
    setMessage("");
    try {
      await openSpace(row.workspace_id, nextPath);
    } catch (err) {
      setOpening(false);
      setError(err instanceof Error ? err.message : "Ouverture impossible.");
    }
  }

  function onRename(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    patch.mutate({ name });
  }

  return (
    <article
      id={`espace-${row.workspace_id}`}
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">{row.name}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATE_CLASS[state]}`}>
              {STATE_LABEL[state]}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {row.owner_name ? `${row.owner_name} · ` : ""}
            {row.owner_email || "sans propriétaire"}
            {row.slug ? ` · /${row.slug}` : ""}
            {row.starter_pack_id ? ` · ${starterPackLabel(row.starter_pack_id)}` : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onOpen("/briefing")}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {opening ? "Ouverture…" : "Ouvrir"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="À toi" value={row.needs_you ?? 0} tone={(row.needs_you || 0) > 0 ? "warn" : "ok"} />
        <StatCard label="En cours" value={row.in_progress ?? 0} tone="info" />
        <StatCard label="IA ce mois" value={iaLabel(row)} hint={row.paused ? "IA en pause" : undefined} />
        <StatCard label="Dernière activité" value={fmtWhen(row.last_activity_at)} />
      </div>

      {row.protected ? (
        <p className="mt-3 text-xs text-slate-500">Espace interne — ouverture seulement.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing((value) => !value);
              setName(row.name);
              setConfirmingDelete(false);
            }}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Renommer
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => patch.mutate({ paused: !row.paused })}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            {patch.isPending ? "Enregistrement…" : row.paused ? "Reprendre l'IA" : "Mettre en pause"}
          </button>
          {archived ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => archive.mutate(true)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {archive.isPending ? "Réactivation…" : "Réactiver"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => archive.mutate(false)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {archive.isPending ? "Archivage…" : "Archiver"}
            </button>
          )}
          {archived ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingDelete((value) => !value);
                setConfirmName("");
                setEditing(false);
              }}
              className="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            >
              Supprimer
            </button>
          ) : null}
        </div>
      )}

      {editing && !row.protected ? (
        <form onSubmit={onRename} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Nom de l&apos;espace
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-64 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
              maxLength={200}
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {patch.isPending ? "Enregistrement…" : "Enregistrer le nom"}
          </button>
        </form>
      ) : null}

      {confirmingDelete && archived ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
          className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40"
        >
          <p className="text-sm text-red-900 dark:text-red-100">
            Suppression définitive. Saisissez <strong>{row.name}</strong> pour confirmer. Les missions, contacts et
            fichiers de cet espace sont effacés.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-red-900 dark:text-red-100">
              Nom de confirmation
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="mt-1 block w-64 rounded-xl border border-red-300 bg-white px-3 py-2 text-sm dark:border-red-800 dark:bg-slate-950"
                autoComplete="off"
              />
            </label>
            <button
              type="submit"
              disabled={busy || confirmName.trim() !== row.name.trim()}
              className="rounded-xl bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {remove.isPending ? "Suppression…" : "Supprimer définitivement"}
            </button>
          </div>
        </form>
      ) : null}

      {message ? <p className="mt-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
      {error ? (
        <p className="mt-3 text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function CreateClient({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [packId, setPackId] = useState("blank");
  const [packs, setPacks] = useState<StarterPackSummary[]>(FALLBACK_STARTER_PACKS);
  const [loadedPacks, setLoadedPacks] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await requestJson("/platform/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, starter_pack_id: packId }),
      });
      return data as SpaceCardData;
    },
    onSuccess: (data) => {
      setError("");
      setMessage(`Espace « ${data.name || name} » créé.`);
      setName("");
      setPackId("blank");
      onCreated();
    },
    onError: (err: Error) => {
      setMessage("");
      setError(err.message || "Création impossible.");
    },
  });

  function reveal() {
    setOpen(true);
    if (!loadedPacks) {
      setLoadedPacks(true);
      void fetchStarterPacks().then(setPacks);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMessage("");
            setError("");
            create.mutate();
          }}
          className="space-y-3"
        >
          <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
            Nom du client
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              className="mt-1 block w-full max-w-md rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
              placeholder="Atelier Martin"
            />
          </label>
          <StarterPackPicker packs={packs} value={packId} onChange={setPackId} disabled={create.isPending} />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {create.isPending ? "Création…" : "Créer l'espace"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
            >
              Fermer
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={reveal}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800"
        >
          Nouveau client
        </button>
      )}
      {message ? (
        <p className="mt-3 text-sm font-semibold text-emerald-700" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function PortefeuillePage() {
  const qc = useQueryClient();
  const portfolio = useQuery({
    queryKey: ["platform-portfolio"],
    queryFn: async () => {
      const { data } = await requestJson("/platform/portfolio");
      return data as { spaces?: SpaceCardData[]; active_count?: number; archived_count?: number };
    },
  });
  const attention = useQuery({
    queryKey: ["platform-attention"],
    queryFn: async () => {
      const { data } = await requestJson("/platform/attention");
      return data as { items?: AttentionItem[]; count?: number };
    },
    enabled: portfolio.isSuccess,
  });

  const spaces = portfolio.data?.spaces || [];
  const active = spaces.filter((row) => row.state !== "archive");
  const archived = spaces.filter((row) => row.state === "archive");
  const items = attention.data?.items || [];
  const [openingId, setOpeningId] = useState("");
  const [queueError, setQueueError] = useState("");

  return (
    <div className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Instance"
        title="Mes clients"
        description="Ce qui se passe dans chaque espace, et les gestes pour le créer, l'ouvrir, le mettre en pause, l'archiver ou le supprimer."
      />

      {portfolio.isError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {(portfolio.error as Error)?.message || "Impossible de lire le portefeuille."}
        </p>
      ) : null}

      {portfolio.isError ? null : (
      <>
      <CreateClient
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ["platform-portfolio"] });
          void qc.invalidateQueries({ queryKey: ["platform-attention"] });
        }}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">À traiter</h2>
        {attention.isLoading ? <p className="text-sm text-slate-500">Chargement de la file…</p> : null}
        {attention.isError ? (
          <p className="text-sm text-red-700" role="alert">
            {(attention.error as Error)?.message || "Impossible de lire la file."}
          </p>
        ) : null}
        {attention.isSuccess && items.length === 0 ? (
          <p className="text-sm text-slate-500">Rien en attente sur les espaces actifs.</p>
        ) : null}
        {queueError ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            {queueError}
          </p>
        ) : null}
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              key={`${item.kind}-${item.workspace_id}-${index}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-50">
                  {item.workspace_name || item.workspace_id}
                  <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {item.kind_label}
                  </span>
                </p>
                <p className="truncate text-sm text-slate-600 dark:text-slate-300">{item.title}</p>
              </div>
              {item.open_path ? (
                <button
                  type="button"
                  disabled={openingId === `${item.workspace_id}-${index}`}
                  onClick={() => {
                    setQueueError("");
                    setOpeningId(`${item.workspace_id}-${index}`);
                    void openSpace(item.workspace_id, "/inbox").catch((err: Error) => {
                      setOpeningId("");
                      setQueueError(err.message || "Ouverture impossible.");
                    });
                  }}
                  className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {openingId === `${item.workspace_id}-${index}` ? "Ouverture…" : "Ouvrir"}
                </button>
              ) : (
                <a
                  href={`#espace-${item.workspace_id}`}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-slate-600 dark:text-slate-100"
                >
                  Voir la carte
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
          Espaces{portfolio.data ? ` (${portfolio.data.active_count ?? active.length})` : ""}
        </h2>
        {portfolio.isLoading ? <p className="text-sm text-slate-500">Chargement des espaces…</p> : null}
        {active.map((row) => (
          <SpaceCard key={row.workspace_id} row={row} />
        ))}
        {portfolio.isSuccess && active.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun espace actif.</p>
        ) : null}
      </section>

      {archived.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Archivés ({archived.length})</h2>
          <p className="text-sm text-slate-500">
            Ces espaces restent consultables. Leurs décisions ne remontent plus dans À traiter.
          </p>
          {archived.map((row) => (
            <SpaceCard key={row.workspace_id} row={row} />
          ))}
        </section>
      ) : null}
      </>
      )}
    </div>
  );
}
