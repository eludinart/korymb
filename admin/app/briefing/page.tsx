"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import InboxActionCard from "../../components/director/InboxActionCard";
import RepriseBriefingSection from "../../components/director/RepriseBriefingSection";
import {
  AlertBox,
  EmptyState,
  LoadingLine,
  PageHeader,
  PageLink,
  PageShell,
  SectionCard,
  StatCard,
} from "../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../lib/api";

function isMariaDbTunnelError(message: string) {
  return /mariadb_tunnel_required/i.test(message);
}

export default function BriefingPage() {
  const briefing = useQuery({
    queryKey: ["admin-briefing"],
    queryFn: async () =>
      (await requestJson("/admin/briefing?period=today", { headers: agentHeaders(), retries: 1, timeoutMs: 60_000 })).data,
    refetchInterval: 120_000,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const b = briefing.data;
  const hitlCount = Number(b?.hitl_pending_count ?? 0);
  const inboxTotal = Number(b?.inbox_total ?? 0);

  return (
    <PageShell size="wide">
      <PageHeader
        accent="violet"
        badge="Cockpit dirigeant"
        title="Briefing du jour"
        description="Décisions urgentes, missions en cours, budget IA et autonomie — tout en un coup d'œil."
        actions={
          <>
            <PageLink href="/inbox">Inbox {inboxTotal > 0 ? `(${inboxTotal})` : ""}</PageLink>
            <PageLink href="/missions" variant="secondary">
              Missions
            </PageLink>
          </>
        }
      />

      {briefing.isLoading ? <LoadingLine /> : null}
      {briefing.isError ? (
        <AlertBox tone="error" title="Briefing indisponible">
          {isMariaDbTunnelError(briefing.error?.message || "") ? (
            <>
              Le tunnel MariaDB est coupé (port 3307). Relancez{" "}
              <span className="font-mono">.\start-dev-cursor.ps1 -MariaDbTunnel</span> ou le script{" "}
              <span className="font-mono">.\scripts\mariadb-vps-tunnel.ps1</span>, puis rechargez cette page.
            </>
          ) : (
            <>Vérifiez que le backend tourne, puis réessayez.</>
          )}
        </AlertBox>
      ) : null}

      <div className="space-y-6">
        <RepriseBriefingSection />

      {b ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Actions inbox" value={inboxTotal} tone={inboxTotal > 0 ? "urgent" : "default"} />
            <StatCard
              label="HITL en attente"
              value={hitlCount}
              tone={hitlCount > 0 ? "warn" : "ok"}
              hint={hitlCount > 0 ? "Décision requise" : undefined}
            />
            <StatCard label="Clôtures pending" value={b.closures_pending_count ?? 0} tone="info" />
            <StatCard label="Approbations" value={b.scheduler_pending_count ?? 0} tone="info" />
          </section>

          <SectionCard title="Budget IA" tone={b.budget?.budget_exceeded || b.budget?.alert ? "alert" : "budget"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-bold text-slate-700">Aujourd&apos;hui</p>
                <p className="stat-value text-2xl">${Number(b.budget?.cost_today_usd || 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Cette semaine</p>
                <p className="stat-value text-2xl">${Number(b.budget?.cost_week_usd || 0).toFixed(2)}</p>
              </div>
            </div>
            {b.budget?.budget_exceeded || b.budget?.alert ? (
              <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-sm font-extrabold text-amber-950 ring-2 ring-amber-300">
                Alerte budget — vérifiez la consommation avant de lancer de nouvelles missions.
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title="Missions actives">
            <ul className="space-y-3">
              {(b.missions_running || []).length === 0 ? (
                <li className="text-muted-strong">Aucune mission en cours.</li>
              ) : (
                (b.missions_running || []).map((m: { job_id: string; mission?: string }) => (
                  <li key={m.job_id} className="flex flex-col gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-base font-bold text-slate-900">{m.mission || m.job_id}</span>
                    <Link href={`/missions?job=${encodeURIComponent(m.job_id)}`} className="btn-link-primary shrink-0">
                      Ouvrir mission
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </SectionCard>

          <section>
            <h2 className="section-title mb-4">Décisions prioritaires</h2>
            <ul className="space-y-3">
              {(b.decisions_today || []).length === 0 ? (
                <EmptyState title="Rien en attente — bonne journée !" />
              ) : (
                (b.decisions_today || []).map((item: Record<string, unknown>, idx: number) => (
                  <InboxActionCard key={`${item.kind}-${item.job_id || item.output_id}-${idx}`} item={item as never} />
                ))
              )}
            </ul>
          </section>
        </>
      ) : null}
      </div>
    </PageShell>
  );
}
