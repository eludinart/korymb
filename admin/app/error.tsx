"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
      <h2 className="text-lg font-bold text-red-950">Une erreur est survenue</h2>
      <p className="mt-2 text-sm text-red-900">{error.message || "Erreur inattendue."}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
      >
        Réessayer
      </button>
    </div>
  );
}
