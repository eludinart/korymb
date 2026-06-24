export type ReflectionTierKey = "lite" | "standard" | "heavy";

export type ReflectionTierRow = {
  key: ReflectionTierKey;
  label: string;
  hint: string;
  model: string;
  priceIn: string;
  priceOut: string;
};

export const REFLECTION_TIER_META: Record<
  ReflectionTierKey,
  { label: string; hint: string; defaultModel: string; defaultPriceIn: number; defaultPriceOut: number }
> = {
  lite: {
    label: "Courant",
    hint: "Réponses rapides, tâches simples et volume élevé.",
    defaultModel: "ministral-8b-latest",
    defaultPriceIn: 0.1,
    defaultPriceOut: 0.1,
  },
  standard: {
    label: "Médium",
    hint: "Équilibre coût / qualité pour la plupart des missions.",
    defaultModel: "mistral-small-latest",
    defaultPriceIn: 0.2,
    defaultPriceOut: 0.6,
  },
  heavy: {
    label: "Expert",
    hint: "Arbitrages, synthèses CIO et raisonnement approfondi.",
    defaultModel: "mistral-large-latest",
    defaultPriceIn: 2.0,
    defaultPriceOut: 6.0,
  },
};

const ORDER: ReflectionTierKey[] = ["lite", "standard", "heavy"];

export function defaultMistralTiersJson(): string {
  const obj: Record<string, object> = {};
  for (const key of ORDER) {
    const m = REFLECTION_TIER_META[key];
    obj[key] = {
      model: m.defaultModel,
      price_input_per_million_usd: m.defaultPriceIn,
      price_output_per_million_usd: m.defaultPriceOut,
    };
  }
  return JSON.stringify(obj, null, 2);
}

export function parseReflectionTiersJson(raw: string): ReflectionTierRow[] {
  let data: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      /* garde les défauts */
    }
  }
  return ORDER.map((key) => {
    const meta = REFLECTION_TIER_META[key];
    const entry = data[key];
    const row =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
    return {
      key,
      label: meta.label,
      hint: meta.hint,
      model: String(row.model || meta.defaultModel).trim(),
      priceIn: String(row.price_input_per_million_usd ?? meta.defaultPriceIn),
      priceOut: String(row.price_output_per_million_usd ?? meta.defaultPriceOut),
    };
  });
}

export function buildReflectionTiersJson(rows: ReflectionTierRow[]): string {
  const obj: Record<string, object> = {};
  for (const row of rows) {
    const pin = parseFloat(row.priceIn);
    const pout = parseFloat(row.priceOut);
    obj[row.key] = {
      model: row.model.trim(),
      price_input_per_million_usd: Number.isFinite(pin) ? pin : 0,
      price_output_per_million_usd: Number.isFinite(pout) ? pout : 0,
    };
  }
  return JSON.stringify(obj, null, 2);
}
