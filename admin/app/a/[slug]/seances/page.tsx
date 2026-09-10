"use client";

import { useParams } from "next/navigation";
import { useSubscriberSpace } from "../../../../lib/subscriberHome";
import { SessionList, SubscriberSpaceStatus } from "../../../../components/espace/SubscriberLists";

export default function SubscriberSeancesPage() {
  const { slug } = useParams<{ slug: string }>();
  const home = useSubscriberSpace(slug);

  if (home.isLoading) {
    return <SubscriberSpaceStatus loading slug={slug} error={null} />;
  }
  if (home.isError || !home.data) {
    return <SubscriberSpaceStatus loading={false} slug={slug} error={home.error} />;
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="practice-kicker">Chez {home.data.name}</p>
        <h1 className="practice-heading mt-2 text-3xl font-extrabold">Mes séances</h1>
        <p className="mt-2 text-slate-600">Ateliers, visios et dates ouvertes qui vous concernent.</p>
      </header>
      <section className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
        <SessionList events={home.data.events || []} />
      </section>
    </div>
  );
}
