"use client";

import Link from "next/link";

export type JarvisYesterday = {
  title?: string;
  excerpt?: string;
  span_count?: number;
  href?: string;
};

export type JarvisAction = {
  label?: string;
  detail?: string;
  href?: string;
};

export type JarvisSuiteItem = {
  id?: string;
  label?: string;
  detail?: string;
  href?: string;
  ready?: boolean;
};

export type JarvisHomeData = {
  line?: string;
  yesterday?: JarvisYesterday | null;
  next_action?: JarvisAction | null;
  suite?: JarvisSuiteItem[];
};

export default function JarvisHome({ data }: { data?: JarvisHomeData | null }) {
  if (!data?.line) return null;
  const yesterday = data.yesterday;
  const action = data.next_action;
  const suite = data.suite || [];

  return (
    <section className="rounded-2xl border border-violet-200 bg-white px-4 py-5 dark:border-violet-800 dark:bg-slate-900 sm:px-6">
      <p className="text-base font-semibold leading-relaxed text-slate-900 dark:text-slate-50">{data.line}</p>

      {yesterday?.title || yesterday?.excerpt ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Je m&apos;appuie sur</p>
          <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">{yesterday.title}</p>
          {yesterday.excerpt ? (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{yesterday.excerpt}</p>
          ) : null}
          {Number(yesterday.span_count || 0) > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              {yesterday.span_count} source{Number(yesterday.span_count) > 1 ? "s" : ""} dans la conversation
            </p>
          ) : null}
          <Link href={yesterday.href || "/chat"} className="mt-2 inline-block text-sm font-semibold text-violet-700 hover:underline">
            Reprendre →
          </Link>
        </div>
      ) : null}

      {action?.href ? (
        <div className="mt-4">
          <Link
            href={action.href}
            className="inline-flex max-w-full flex-col rounded-xl bg-violet-700 px-4 py-3 text-white hover:bg-violet-800"
          >
            <span className="text-sm font-bold">{action.label || "Continuer"}</span>
            {action.detail ? <span className="mt-0.5 text-xs text-violet-100">{action.detail}</span> : null}
          </Link>
        </div>
      ) : null}

      {suite.length > 0 ? (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Ensuite</p>
          <ul className="mt-2 space-y-2">
            {suite.map((item) => {
              const ready = item.ready !== false && Boolean(item.href);
              const body = (
                <>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{item.label}</span>
                  {item.detail ? <span className="block text-xs text-slate-500">{item.detail}</span> : null}
                </>
              );
              return (
                <li key={item.id || item.label}>
                  {ready ? (
                    <Link href={item.href || "/chat"} className="block rounded-lg px-1 py-1 hover:bg-violet-50 dark:hover:bg-violet-950">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-1 py-1 opacity-70">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
