"use client";

type Props = {
  answer: string;
  compact?: boolean;
};

export default function CioAnswerResult({ answer, compact = false }: Props) {
  return (
    <div
      className={`rounded-xl border border-emerald-200 bg-emerald-50/90 ${compact ? "p-2.5" : "p-3"} space-y-1.5`}
    >
      <p className={`font-bold text-emerald-800 ${compact ? "text-[11px]" : "text-xs"}`}>
        ✓ Réponse enregistrée
      </p>
      <p className={`font-semibold text-slate-800 ${compact ? "text-xs" : "text-sm"}`}>{answer}</p>
      <p className={`text-slate-500 ${compact ? "text-[10px]" : "text-[11px]"}`}>
        Ajoutée au fil de la mission — le CIO l&apos;intègre dans la synthèse en cours ou à venir.
      </p>
    </div>
  );
}
