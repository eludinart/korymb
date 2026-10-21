"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [helpHref, setHelpHref] = useState("/aide");

  useEffect(() => {
    console.error(error);
    const query = new URLSearchParams();
    query.set("page", window.location.pathname);
    const message = (error.message || "").trim().slice(0, 500);
    if (message) query.set("message", message);
    setHelpHref(`/aide?${query.toString()}`);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
      <h2 className="text-lg font-bold text-red-950">Une erreur est survenue</h2>
      <p className="mt-2 text-sm text-red-900">{error.message || "Erreur inattendue."}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          Réessayer
        </button>
        <Link
          href={helpHref}
          className="rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100"
        >
          Signaler ce problème
        </Link>
      </div>
    </div>
  );
}
