"use client";

import type { OrbMood } from "../../lib/chatProgress";

const MOOD_LABEL: Record<OrbMood, string> = {
  idle: "Prêt",
  preparing: "Je prépare",
  searching: "Je cherche",
  writing: "Je rédige",
  speaking: "Korymb parle",
  waiting: "J'attends votre feu vert",
};

type Props = {
  mood?: OrbMood;
  size?: "sm" | "md" | "lg";
  /** Le texte voisin annonce déjà le statut. */
  decorative?: boolean;
};

/** Bulle de présence de Korymb. La couleur et le mouvement suivent le statut. */
export default function CorimbeOrb({ mood = "idle", size = "md", decorative = false }: Props) {
  const label = MOOD_LABEL[mood];
  return (
    <span
      className="corimbe-orb"
      data-mood={mood}
      data-size={size}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
    >
      {mood === "speaking" ? (
        <>
          <span className="corimbe-orb-glow" aria-hidden />
          <span className="corimbe-orb-ripple" aria-hidden />
          <span className="corimbe-orb-ripple corimbe-orb-ripple-late" aria-hidden />
          <span className="corimbe-orb-sheen" aria-hidden />
          <span className="corimbe-orb-arc" aria-hidden />
          <span className="corimbe-orb-arc corimbe-orb-arc-late" aria-hidden />
        </>
      ) : null}
    </span>
  );
}
