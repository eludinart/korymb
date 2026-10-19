"use client";

import Link from "next/link";
import { useUiMode } from "../../lib/uiMode";

export type LlmEnvelope = {
  applies?: boolean;
  exempt?: boolean;
  own_key?: boolean;
  paused?: boolean;
  blocked?: boolean;
  warn?: boolean;
  percent?: number;
  monthly_token_cap?: number;
  tokens_used_month?: number;
  tokens_remaining?: number | null;
  renews_on?: string;
  billing?: string;
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1000) return `${Math.round(n / 1000)} k`;
  return String(n);
}

export default function EnvelopeNotice({ envelope }: { envelope?: LlmEnvelope | null }) {
  const { isPlatformOwner } = useUiMode();
  if (!envelope || envelope.exempt) return null;
  if (!envelope.paused && !envelope.blocked && !envelope.warn) return null;
  if (!envelope.applies && !envelope.paused) return null;
  const blocked = Boolean(envelope.blocked);
  const detail = envelope.paused
    ? "Les demandes et les missions ne partent plus tant que la pause est levée."
    : blocked
      ? "Le chat et les missions sont interrompus jusqu'au 1er du mois."
      : `Il reste ${fmtTokens(Number(envelope.tokens_remaining || 0))} tokens sur ${fmtTokens(Number(envelope.monthly_token_cap || 0))}.`;
  return (
    <div
      className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
        blocked
          ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
          : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      }`}
    >
      <p className="font-bold">
        {envelope.paused
          ? "L'IA de cet espace est en pause."
          : blocked
            ? "L'enveloppe IA de cet espace est atteinte pour ce mois."
            : `Enveloppe IA : ${envelope.percent ?? 0} % utilisée ce mois.`}
      </p>
      <p className="mt-1">{detail}</p>
      {isPlatformOwner ? (
        <Link href="/administration/budget" className="mt-2 inline-block font-bold underline">
          Voir le budget
        </Link>
      ) : null}
    </div>
  );
}
