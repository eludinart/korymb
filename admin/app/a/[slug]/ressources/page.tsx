"use client";

import { useParams } from "next/navigation";
import { useSubscriberSpace } from "../../../../lib/subscriberHome";
import {
  ResourceList,
  SubscriberSpaceStatus,
  UpcomingList,
} from "../../../../components/espace/SubscriberLists";

export default function SubscriberRessourcesPage() {
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
        <h1 className="practice-heading mt-2 text-3xl font-extrabold">Mes ressources</h1>
        <p className="mt-2 text-slate-600">Vidéos, podcasts et documents débloqués à leur date de mise à disposition.</p>
      </header>
      <section className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <ResourceList resources={home.data.resources || []} />
      </section>
      <UpcomingList upcoming={home.data.resources_upcoming || []} />
    </div>
  );
}
