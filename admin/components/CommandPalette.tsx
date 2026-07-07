"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../lib/api";
import { QK } from "../lib/queryClient";
import { GESTION_NAV_LINKS, GESTION_QUICK_ACTIONS } from "../lib/gestionNav";
import type { Job } from "../lib/types";

type Command = {
  id: string;
  label: string;
  hint?: string;
  href?: string;
  action?: () => void;
  group: string;
};

/** Shell sans useRouter — évite « expected app router to be mounted » au 1er paint. */
export default function CommandPalette() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <CommandPaletteInner />;
}

function CommandPaletteInner() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 0, timeoutMs: 12_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    enabled: open,
    staleTime: 30_000,
  });

  const baseCommands: Command[] = useMemo(() => {
    const gestionNav: Command[] = GESTION_NAV_LINKS.map((link) => ({
      id: `gestion-${link.href}`,
      label: link.label,
      hint: link.hint,
      href: link.href,
      group: "Gestion entreprise",
    }));
    const gestionActions: Command[] = GESTION_QUICK_ACTIONS.map((action) => ({
      id: action.id,
      label: action.label,
      hint: action.hint,
      href: action.href,
      group: "Actions gestion",
    }));
    return [
      { id: "briefing", label: "Briefing du jour", href: "/briefing", group: "Navigation" },
      ...gestionNav,
      ...gestionActions,
      { id: "triage", label: "Traiter l'inbox (mode triage)", href: "/inbox?triage=1", group: "Actions IA" },
      { id: "inbox", label: "Inbox dirigeant", href: "/inbox", group: "Navigation" },
      { id: "missions", label: "Missions", href: "/missions", group: "Navigation" },
      { id: "mission-new", label: "Lancer une mission", href: "/missions?create=1", group: "Actions IA" },
      { id: "chat", label: "Chat dirigeant", href: "/chat", group: "Navigation" },
      { id: "livrables", label: "Bibliothèque livrables", href: "/livrables", group: "Navigation" },
      { id: "dashboard", label: "Vue agents", href: "/dashboard", group: "Navigation" },
      {
        id: "budget",
        label: "Budget & coûts IA",
        href: "/administration/budget",
        group: "Administration",
      },
    ];
  }, []);

  const jobCommands: Command[] = useMemo(() => {
    const rows = (jobs.data || []).filter((j) => String(j.source || "") !== "chat").slice(0, 12);
    return rows.map((j) => ({
      id: `job-${j.job_id}`,
      label: (j.mission || j.job_id || "Mission").slice(0, 72),
      hint: j.status,
      href: `/missions?job=${encodeURIComponent(j.job_id || "")}`,
      group: "Missions récentes",
    }));
  }, [jobs.data]);

  const allCommands = useMemo(() => [...baseCommands, ...jobCommands], [baseCommands, jobCommands]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
    );
  }, [allCommands, query]);

  const runCommand = useCallback(
    (cmd: Command) => {
      setOpen(false);
      setQuery("");
      if (cmd.action) {
        cmd.action();
        return;
      }
      if (cmd.href) router.push(cmd.href);
    },
    [router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setActive(0);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter" && filtered[active]) {
        e.preventDefault();
        runCommand(filtered[active]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, runCommand]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const groups = Array.from(new Set(filtered.map((c) => c.group)));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/50 p-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-label="Palette de commandes"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une action, une mission…"
            className="w-full bg-transparent text-base font-medium text-slate-900 outline-none placeholder:text-slate-400"
          />
          <p className="mt-1 text-[11px] text-slate-400">Ctrl+K · ↑↓ naviguer · Entrée valider</p>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-slate-500">Aucun résultat</li>
          ) : (
            groups.map((group) => (
              <li key={group}>
                <p className="px-4 py-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{group}</p>
                {filtered
                  .filter((c) => c.group === group)
                  .map((cmd) => {
                    const globalIdx = filtered.indexOf(cmd);
                    const isActive = globalIdx === active;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onMouseEnter={() => setActive(globalIdx)}
                        onClick={() => runCommand(cmd)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                          isActive ? "bg-violet-50 text-violet-950" : "text-slate-800 hover:bg-slate-50"
                        }`}
                      >
                        <span className="font-semibold">{cmd.label}</span>
                        {cmd.hint ? <span className="text-xs text-slate-400">{cmd.hint}</span> : null}
                      </button>
                    );
                  })}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
