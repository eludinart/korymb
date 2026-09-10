"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { StorefrontView } from "../../../components/practice/StorefrontView";
import { loadPublicStorefront } from "../../../lib/storefront";

export default function PublicStorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const q = useQuery({
    queryKey: ["storefront-public", slug],
    queryFn: () => loadPublicStorefront(String(slug || "")),
    enabled: Boolean(slug),
    retry: 1,
  });

  if (q.isLoading) {
    return <p className="py-16 text-center text-sm text-slate-500">Chargement…</p>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold text-slate-900">Page indisponible</h1>
        <p className="mt-3 text-sm text-slate-600">
          {q.error instanceof Error ? q.error.message : "Cette page n’est pas publiée."}
        </p>
        <Link href="/" className="mt-6 inline-block font-semibold text-slate-800 hover:underline">
          Retour à l’accueil
        </Link>
      </div>
    );
  }

  return <StorefrontView data={q.data} />;
}
