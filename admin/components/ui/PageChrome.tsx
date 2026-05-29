import Link from "next/link";
import type { ReactNode } from "react";

type Accent = "violet" | "amber" | "emerald" | "sky" | "rose";

const accentBar: Record<Accent, string> = {
  violet: "from-violet-600 to-indigo-600",
  amber: "from-amber-500 to-orange-600",
  emerald: "from-emerald-600 to-teal-600",
  sky: "from-sky-600 to-blue-600",
  rose: "from-rose-600 to-pink-600",
};

export function PageShell({
  children,
  size = "default",
  className = "",
}: {
  children: ReactNode;
  size?: "narrow" | "default" | "wide";
  className?: string;
}) {
  const max =
    size === "narrow" ? "max-w-3xl" : size === "wide" ? "max-w-7xl" : "max-w-5xl";
  return <div className={`page-shell ${max} ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  badge,
  accent = "violet",
  actions,
}: {
  title: string;
  description?: string;
  badge?: string;
  accent?: Accent;
  actions?: ReactNode;
}) {
  return (
    <header className={`page-header page-header--${accent}`}>
      <div className={`page-header-accent bg-gradient-to-r ${accentBar[accent]}`} aria-hidden />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {badge ? <span className="page-badge mb-2">{badge}</span> : null}
          <h1 className="page-title">{title}</h1>
          {description ? <p className="page-lead">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function PageLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link href={href} className={variant === "primary" ? "btn-link-primary" : "btn-link-secondary"}>
      {children}
    </Link>
  );
}

type StatTone = "default" | "urgent" | "warn" | "ok" | "info";

export function StatCard({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: StatTone;
  hint?: string;
}) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  children,
  tone = "default",
  action,
}: {
  title: string;
  children: ReactNode;
  tone?: "default" | "budget" | "alert";
  action?: ReactNode;
}) {
  return (
    <section className={`section-card section-card--${tone}`}>
      <div className="section-card-head">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      <div className="section-card-body">{children}</div>
    </section>
  );
}

export function AlertBox({
  tone,
  title,
  children,
}: {
  tone: "error" | "warn" | "success" | "info";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`alert-box alert-box--${tone}`} role="alert">
      {title ? <p className="alert-title">{title}</p> : null}
      <div className="alert-body">{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {children ? <div className="empty-state-body">{children}</div> : null}
    </div>
  );
}

export function LoadingLine({ label = "Chargement…" }: { label?: string }) {
  return <p className="loading-line">{label}</p>;
}
