"use client";

export type ContextOffer = {
  id: string;
  kind?: "standard" | "gap";
  title?: string;
  hint?: string;
  question?: string;
};

type Props = {
  offers: ContextOffer[];
  mode?: "standards" | "gaps" | string;
  busy?: boolean;
  onOpen: (id: string) => void;
  onDismiss: (id: string) => void;
};

export default function ContextOffers({ offers, mode, busy, onOpen, onDismiss }: Props) {
  if (!offers.length) return null;
  const standards = mode !== "gaps";
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-slate-900">
          {standards ? "Ou un standard, pour commencer" : "Suite du parcours"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {standards
            ? "Grands standards d’une activité ou d’une association, si vous préférez partir de là. Masquez ceux qui ne concernent pas l’entreprise : ils ne reviendront pas."
            : "Ces questions prolongent la science déjà écrite, ou une demande déjà faite. Masquez celles qui ne vous intéressent pas."}
        </p>
      </div>
      <ul className="space-y-3">
        {offers.map((offer) => (
          <li key={offer.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900">{offer.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{offer.hint}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpen(offer.id)}
                  className="rounded-xl border border-violet-300 px-3 py-2 text-sm font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-60"
                >
                  Répondre
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDismiss(offer.id)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Masquer
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
