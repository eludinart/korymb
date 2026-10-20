"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../lib/api";
import { businessApi, type MailboxThread } from "../lib/business";
import { mailtoHref, telHref } from "../lib/contactLinks";
import { QK } from "../lib/queryClient";
import { DIRECTOR_QUEUE_HREF, DIRECTOR_QUEUE_HINT, DIRECTOR_QUEUE_LABEL } from "../lib/directorQueue";
import { GESTION_NAV_LINKS, GESTION_QUICK_ACTIONS, filterGestionNavLinks } from "../lib/gestionNav";
import type { Job } from "../lib/types";
import { useUiMode } from "../lib/uiMode";

type Command = {
  id: string;
  label: string;
  hint?: string;
  href?: string;
  action?: () => void;
  group: string;
};

type LensHit = {
  id: string;
  group: "Personnes" | "Projets" | "Messages";
  label: string;
  hint?: string;
  href: string;
  actions: { label: string; href: string }[];
};

type PaletteRow = { kind: "lens"; hit: LensHit } | { kind: "command"; command: Command };

function includesQuery(q: string, parts: Array<string | undefined | null>): boolean {
  return parts.some((part) => String(part || "").toLowerCase().includes(q));
}

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
  const [sheet, setSheet] = useState<LensHit | null>(null);
  const needle = query.trim().toLowerCase();
  const lensOn = open && needle.length >= 2;

  const { showAdvanced, isPlatformOwner, workspaceSlug } = useUiMode();
  const essential = !showAdvanced;

  const jobs = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () => {
      const { data } = await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 0, timeoutMs: 12_000 });
      return ((data as { jobs?: Job[] })?.jobs || []) as Job[];
    },
    enabled: open && showAdvanced,
    staleTime: 30_000,
  });

  const contactsQ = useQuery({
    queryKey: ["business-contacts"],
    queryFn: () => businessApi.listContacts(),
    enabled: lensOn,
    staleTime: 60_000,
  });
  const projectsQ = useQuery({
    queryKey: ["business-projects"],
    queryFn: () => businessApi.listProjects(),
    enabled: lensOn,
    staleTime: 60_000,
  });
  const mailboxQ = useQuery({
    queryKey: ["business-mailbox"],
    queryFn: async () => {
      try {
        return await businessApi.listMailbox("all");
      } catch {
        return { threads: [] as MailboxThread[] };
      }
    },
    enabled: lensOn,
    staleTime: 60_000,
  });

  const baseCommands: Command[] = useMemo(() => {
    const gestionLinks = filterGestionNavLinks(GESTION_NAV_LINKS, { essential });
    const gestionNav: Command[] = gestionLinks.map((link) => ({
      id: `gestion-${link.href}`,
      label: link.label,
      hint: link.hint,
      href: link.href,
      group: "Gestion entreprise",
    }));
    const gestionActions: Command[] = (essential
      ? GESTION_QUICK_ACTIONS.filter((a) => ["new-contact", "new-event", "new-quote", "new-task"].includes(a.id))
      : GESTION_QUICK_ACTIONS
    ).map((action) => ({
      id: action.id,
      label: action.label,
      hint: action.hint,
      href: action.href,
      group: "Actions gestion",
    }));
    const slug = workspaceSlug;
    const espaceCommands: Command[] = slug
      ? [
          {
            id: "espace-participant",
            label: "Mon espace",
            hint: "Ce que voient les inscrits",
            href: `/a/${encodeURIComponent(slug)}`,
            group: "Navigation",
          },
        ]
      : [];
    const nav: Command[] = [
      { id: "chat", label: "Conversation", href: "/chat", group: "Navigation" },
      { id: "briefing", label: "Aujourd'hui", href: "/briefing", group: "Navigation" },
    ];
    if (!essential) {
      nav.push({
        id: "carte",
        label: "Carte des projets",
        hint: "Équipes, missions, où j'en suis",
        href: "/carte",
        group: "Navigation",
      });
    }
    return [
      ...nav,
      ...espaceCommands,
      ...gestionNav,
      ...gestionActions,
      {
        id: "triage",
        label: "Traiter ce qui est à valider",
        hint: DIRECTOR_QUEUE_HINT,
        href: `${DIRECTOR_QUEUE_HREF}?triage=1`,
        group: "Actions IA",
      },
      {
        id: "inbox",
        label: DIRECTOR_QUEUE_LABEL,
        hint: DIRECTOR_QUEUE_HINT,
        href: DIRECTOR_QUEUE_HREF,
        group: "Navigation",
      },
      ...(essential
        ? []
        : [
            { id: "missions", label: "Travaux", href: "/missions", group: "Navigation" },
            { id: "mission-new", label: "Nouveau travail", href: "/missions?create=1", group: "Actions IA" },
          ]),
      ...(essential
        ? []
        : [
            { id: "dashboard", label: "Vue agents", href: "/dashboard", group: "Navigation" },
            ...(isPlatformOwner
              ? [
                  {
                    id: "budget",
                    label: "Budget & coûts IA",
                    href: "/administration/budget",
                    group: "Administration",
                  },
                ]
              : []),
          ]),
    ];
  }, [essential, isPlatformOwner, workspaceSlug]);

  const jobCommands: Command[] = useMemo(() => {
    if (essential) return [];
    const rows = (jobs.data || []).filter((j) => String(j.source || "") !== "chat").slice(0, 12);
    return rows.map((j) => ({
      id: `job-${j.job_id}`,
      label: (j.mission || j.job_id || "Mission").slice(0, 72),
      hint: j.status,
      href: `/missions?job=${encodeURIComponent(j.job_id || "")}`,
      group: "Missions récentes",
    }));
  }, [essential, jobs.data]);

  const allCommands = useMemo(() => [...baseCommands, ...jobCommands], [baseCommands, jobCommands]);

  const lensHits = useMemo(() => {
    if (needle.length < 2) return [] as LensHit[];
    const people = (contactsQ.data || [])
      .filter((c) => includesQuery(needle, [c.name, c.email, c.company, c.phone, ...(c.tags || [])]))
      .slice(0, 5)
      .map((c): LensHit => {
        const href = `/gestion/contacts/${encodeURIComponent(c.id)}`;
        const actions = [
          ...(mailtoHref(c.email) ? [{ label: "Écrire", href: mailtoHref(c.email) }] : []),
          ...(telHref(c.phone) ? [{ label: "Appeler", href: telHref(c.phone) }] : []),
          { label: "Ouvrir", href },
        ];
        return {
          id: `lens-contact-${c.id}`,
          group: "Personnes",
          label: c.name,
          hint: c.company || c.email || undefined,
          href,
          actions,
        };
      });
    const projects = (projectsQ.data || [])
      .filter((p) => includesQuery(needle, [p.title, p.description, p.location, p.status]))
      .slice(0, 5)
      .map((p): LensHit => {
        const href = `/gestion/projets/${encodeURIComponent(p.id)}`;
        return {
          id: `lens-project-${p.id}`,
          group: "Projets",
          label: p.title,
          hint: p.status,
          href,
          actions: [{ label: "Ouvrir", href }],
        };
      });
    const threads = (mailboxQ.data?.threads || [])
      .filter((t) => includesQuery(needle, [t.subject, t.to_email, t.preview, t.contact?.name, t.contact?.email]))
      .slice(0, 5)
      .map((t): LensHit => {
        const href = `/gestion/courrier?thread=${encodeURIComponent(t.id)}`;
        return {
          id: `lens-mail-${t.id}`,
          group: "Messages",
          label: t.subject || "Sans objet",
          hint: t.contact?.name || t.to_email,
          href,
          actions: [{ label: "Ouvrir", href }],
        };
      });
    return [...people, ...projects, ...threads];
  }, [needle, contactsQ.data, projectsQ.data, mailboxQ.data]);

  const rows = useMemo(() => {
    const commands = needle
      ? allCommands.filter(
          (c) =>
            c.label.toLowerCase().includes(needle) ||
            c.group.toLowerCase().includes(needle) ||
            c.hint?.toLowerCase().includes(needle),
        )
      : allCommands;
    const lensRows: PaletteRow[] = lensHits.map((hit) => ({ kind: "lens", hit }));
    const commandRows: PaletteRow[] = commands.map((command) => ({ kind: "command", command }));
    return [...lensRows, ...commandRows];
  }, [allCommands, lensHits, needle]);

  const openHit = useCallback((hit: LensHit, go: boolean) => {
    setOpen(false);
    setQuery("");
    if (go) {
      setSheet(null);
      router.push(hit.href);
      return;
    }
    setSheet(hit);
  }, [router]);

  const runCommand = useCallback(
    (cmd: Command) => {
      setOpen(false);
      setQuery("");
      setSheet(null);
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
      if (e.key === "Escape") {
        if (open) {
          e.preventDefault();
          setOpen(false);
          return;
        }
        if (sheet) {
          e.preventDefault();
          setSheet(null);
        }
        return;
      }
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, rows.length - 1)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter" && rows[active]) {
        e.preventDefault();
        const row = rows[active];
        const go = e.metaKey || e.ctrlKey;
        if (row.kind === "lens") openHit(row.hit, go);
        else runCommand(row.command);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, active, runCommand, openHit, sheet]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const groups = Array.from(new Set(rows.map((row) => (row.kind === "lens" ? row.hit.group : row.command.group))));

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-start sm:p-4 sm:pt-[12vh]"
          role="dialog"
          aria-label="Palette de commandes"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-xl overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Une personne, un projet, une action…"
                className="w-full bg-transparent text-base font-medium text-slate-900 outline-none placeholder:text-slate-400"
              />
              <p className="mt-1 text-[11px] text-slate-400">Ctrl+K · ↑↓ · Entrée ouvre · Ctrl+Entrée va à la fiche</p>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-2">
              {rows.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-slate-500">Aucun résultat</li>
              ) : (
                groups.map((group) => (
                  <li key={group}>
                    <p className="px-4 py-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">{group}</p>
                    {rows.map((row, globalIdx) => {
                      const rowGroup = row.kind === "lens" ? row.hit.group : row.command.group;
                      if (rowGroup !== group) return null;
                      const isActive = globalIdx === active;
                      const label = row.kind === "lens" ? row.hit.label : row.command.label;
                      const hint = row.kind === "lens" ? row.hit.hint : row.command.hint;
                      const id = row.kind === "lens" ? row.hit.id : row.command.id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onMouseEnter={() => setActive(globalIdx)}
                          onClick={(e) => {
                            if (row.kind === "lens") openHit(row.hit, e.metaKey || e.ctrlKey);
                            else runCommand(row.command);
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                            isActive ? "bg-violet-50 text-violet-950" : "text-slate-800 hover:bg-slate-50"
                          }`}
                        >
                          <span className="font-semibold">{label}</span>
                          {hint ? <span className="truncate text-xs text-slate-400">{hint}</span> : null}
                        </button>
                      );
                    })}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
      {sheet ? (
        <div className="fixed inset-0 z-[110] flex justify-end bg-slate-900/30" onClick={() => setSheet(null)}>
          <aside
            className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{sheet.group}</p>
            <h2 className="mt-1 text-xl font-extrabold text-slate-950">{sheet.label}</h2>
            {sheet.hint ? <p className="mt-1 text-sm text-slate-500">{sheet.hint}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              {sheet.actions.map((action) =>
                action.href.startsWith("/") ? (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      const href = action.href;
                      setSheet(null);
                      router.push(href);
                    }}
                    className="rounded-full bg-violet-700 px-4 py-2 text-sm font-bold text-white"
                  >
                    {action.label}
                  </button>
                ) : (
                  <a
                    key={action.label}
                    href={action.href}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800"
                  >
                    {action.label}
                  </a>
                ),
              )}
            </div>
            <button
              type="button"
              onClick={() => setSheet(null)}
              className="mt-auto text-sm font-semibold text-slate-500 hover:text-slate-800"
            >
              Fermer
            </button>
          </aside>
        </div>
      ) : null}
    </>
  );
}
