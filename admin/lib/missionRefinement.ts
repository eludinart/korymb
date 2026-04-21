/** Plafond aligné sur `backend/main.py` (`KORYMB_MAX_REFINEMENT_ROUNDS`, `MissionRunConfig.recursive_max_rounds`). */
export const MAX_REFINEMENT_ROUNDS = 12;
export const DEFAULT_REFINEMENT_ROUNDS = 2;

export const REFINEMENT_ROUND_OPTIONS = Array.from({ length: MAX_REFINEMENT_ROUNDS }, (_, i) => i + 1);

export function clampRefinementRounds(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_REFINEMENT_ROUNDS;
  return Math.min(MAX_REFINEMENT_ROUNDS, Math.max(1, v));
}
