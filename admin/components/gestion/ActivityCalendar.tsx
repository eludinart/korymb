"use client";

import Link from "next/link";
import { EVENT_NATURE_SHORT_LABELS, EVENT_RESOURCE_TYPE_LABELS, formatDateTime } from "../../app/gestion/_shared";
import type { BizEvent } from "../lib/business";

export type CalendarZoom = "day" | "week" | "month" | "year";
export type NatureFilter = "all" | "presence" | "matiere";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfLocalDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(x, diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

export function rangeForZoom(anchor: Date, zoom: CalendarZoom): { from: Date; to: Date } {
  if (zoom === "day") {
    const from = startOfLocalDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (zoom === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  if (zoom === "month") {
    const from = startOfMonth(anchor);
    return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 1) };
  }
  const from = startOfYear(anchor);
  return { from, to: new Date(from.getFullYear() + 1, 0, 1) };
}

export function shiftAnchor(anchor: Date, zoom: CalendarZoom, dir: -1 | 1): Date {
  const x = new Date(anchor);
  if (zoom === "day") x.setDate(x.getDate() + dir);
  else if (zoom === "week") x.setDate(x.getDate() + 7 * dir);
  else if (zoom === "month") x.setMonth(x.getMonth() + dir);
  else x.setFullYear(x.getFullYear() + dir);
  return x;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function natureOf(ev: BizEvent): "presence" | "matiere" {
  if (ev.nature === "matiere" || ev.resource_type) return "matiere";
  return "presence";
}

function pillClass(ev: BizEvent): string {
  return natureOf(ev) === "matiere"
    ? "bg-violet-100 text-violet-900 hover:bg-violet-200"
    : "bg-emerald-100 text-emerald-900 hover:bg-emerald-200";
}

function zoomLabel(anchor: Date, zoom: CalendarZoom): string {
  if (zoom === "day") {
    return anchor.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  if (zoom === "week") {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return `${from.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${to.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (zoom === "month") {
    return anchor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }
  return String(anchor.getFullYear());
}

type Props = {
  events: BizEvent[];
  zoom: CalendarZoom;
  nature: NatureFilter;
  anchor: Date;
  onZoom: (z: CalendarZoom) => void;
  onNature: (n: NatureFilter) => void;
  onAnchor: (d: Date) => void;
};

export default function ActivityCalendar({ events, zoom, nature, anchor, onZoom, onNature, onAnchor }: Props) {
  const visible = events.filter((ev) => {
    if (ev.is_follow_up) return false;
    if (ev.status === "cancelled") return false;
    if (nature !== "all" && natureOf(ev) !== nature) return false;
    return true;
  });
  const byDay = new Map<string, BizEvent[]>();
  for (const ev of visible) {
    const k = dayKey(ev.starts_at);
    if (!k) continue;
    const list = byDay.get(k) || [];
    list.push(ev);
    byDay.set(k, list);
  }

  const { from } = rangeForZoom(anchor, zoom);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {(["day", "week", "month", "year"] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => onZoom(z)}
              className={
                zoom === z
                  ? "rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
                  : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              }
            >
              {z === "day" ? "Jour" : z === "week" ? "Semaine" : z === "month" ? "Mois" : "Année"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["all", "presence", "matiere"] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onNature(n)}
              className={
                nature === n
                  ? "rounded-full bg-slate-800 px-3 py-1.5 text-xs font-bold text-white"
                  : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              }
            >
              {n === "all" ? "Tout" : EVENT_NATURE_SHORT_LABELS[n]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={() => onAnchor(shiftAnchor(anchor, zoom, -1))}>
          ←
        </button>
        <button type="button" className="btn-secondary text-sm" onClick={() => onAnchor(new Date())}>
          Aujourd’hui
        </button>
        <button type="button" className="btn-secondary text-sm" onClick={() => onAnchor(shiftAnchor(anchor, zoom, 1))}>
          →
        </button>
        <p className="text-sm font-bold capitalize text-slate-900">{zoomLabel(anchor, zoom)}</p>
      </div>

      <p className="text-xs text-slate-500">
        <span className="mr-2 inline-block rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-900">Rendez-vous</span>
        <span className="inline-block rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-900">Documents & vidéos</span>
      </p>

      {zoom === "year" ? <YearGrid year={anchor.getFullYear()} byDay={byDay} /> : null}
      {zoom === "month" ? <MonthGrid monthStart={startOfMonth(anchor)} byDay={byDay} /> : null}
      {zoom === "week" ? <WeekGrid weekStart={from} byDay={byDay} /> : null}
      {zoom === "day" ? <DayList events={byDay.get(localKey(startOfLocalDay(anchor))) || []} /> : null}
    </div>
  );
}

function EventChip({ ev }: { ev: BizEvent }) {
  const extra = ev.resource_type ? EVENT_RESOURCE_TYPE_LABELS[ev.resource_type] : null;
  return (
    <Link href={`/gestion/planning/${ev.id}`} className={`block truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${pillClass(ev)}`} title={ev.title}>
      {ev.title}
      {extra ? ` · ${extra}` : ""}
    </Link>
  );
}

function MonthGrid({ monthStart, byDay }: { monthStart: Date; byDay: Map<string, BizEvent[]> }) {
  const first = startOfWeek(monthStart);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i += 1) cells.push(addDays(first, i));
  const month = monthStart.getMonth();
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7 gap-px rounded-xl border border-slate-200 bg-slate-200">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-slate-50 px-2 py-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const key = localKey(d);
          const list = byDay.get(key) || [];
          const inMonth = d.getMonth() === month;
          const today = localKey(new Date()) === key;
          return (
            <div key={key} className={`min-h-[5.5rem] bg-white p-1 ${inMonth ? "" : "bg-slate-50/80 text-slate-400"} ${today ? "ring-2 ring-inset ring-emerald-400" : ""}`}>
              <p className="px-1 text-xs font-bold">{d.getDate()}</p>
              <div className="mt-1 space-y-0.5">
                {list.slice(0, 3).map((ev) => (
                  <EventChip key={ev.id} ev={ev} />
                ))}
                {list.length > 3 ? <p className="px-1 text-[10px] text-slate-500">+{list.length - 3}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ weekStart, byDay }: { weekStart: Date; byDay: Map<string, BizEvent[]> }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="grid gap-2 sm:grid-cols-7">
      {days.map((d) => {
        const key = localKey(d);
        const list = byDay.get(key) || [];
        return (
          <div key={key} className="rounded-xl border border-slate-200 bg-white p-2">
            <p className="text-xs font-extrabold uppercase text-slate-500">{WEEKDAYS[(d.getDay() + 6) % 7]}</p>
            <p className="text-sm font-bold text-slate-900">{d.getDate()}</p>
            <div className="mt-2 space-y-1">
              {list.length === 0 ? <p className="text-[11px] text-slate-400">—</p> : list.map((ev) => <EventChip key={ev.id} ev={ev} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayList({ events }: { events: BizEvent[] }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white">
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Rien de prévu ce jour-là.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((ev) => (
            <li key={ev.id} className="px-4 py-3">
              <Link href={`/gestion/planning/${ev.id}`} className="font-semibold text-slate-900 hover:underline">
                {ev.title}
              </Link>
              <p className="text-sm text-slate-600">{formatDateTime(ev.starts_at)}</p>
              <p className="text-xs font-semibold text-slate-500">
                {EVENT_NATURE_SHORT_LABELS[natureOf(ev)]}
                {ev.resource_type ? ` · ${EVENT_RESOURCE_TYPE_LABELS[ev.resource_type]}` : ""}
                {ev.is_public ? " · Vitrine" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function YearGrid({ year, byDay }: { year: number; byDay: Map<string, BizEvent[]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {MONTHS.map((label, month) => {
        const start = new Date(year, month, 1);
        let countA = 0;
        let countB = 0;
        const cursor = new Date(start);
        while (cursor.getMonth() === month && cursor.getFullYear() === year) {
          const list = byDay.get(localKey(cursor)) || [];
          for (const ev of list) {
            if (natureOf(ev) === "matiere") countB += 1;
            else countA += 1;
          }
          cursor.setDate(cursor.getDate() + 1);
        }
        return (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-bold text-slate-900">{label}</p>
            <p className="mt-2 text-xs text-emerald-800">{countA} rendez-vous</p>
            <p className="text-xs text-violet-800">{countB} documents</p>
          </div>
        );
      })}
    </div>
  );
}
