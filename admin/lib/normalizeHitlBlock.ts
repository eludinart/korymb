/** Normalise le bloc HITL renvoyé par l'API (formes variables selon l'écran). */
export type HitlBlock = {
  gate?: Record<string, unknown>;
  resolved_at?: string | null;
  comment?: string | null;
  resolution?: Record<string, unknown> | null;
};

export function normalizeHitlBlock(raw: unknown): HitlBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // Réponse GET /jobs/:id/hitl → { hitl: { gate, ... } }
  if (o.hitl && typeof o.hitl === "object") {
    return normalizeHitlBlock(o.hitl);
  }

  // Bloc direct { gate, resolved_at, ... }
  if (o.gate && typeof o.gate === "object") {
    return {
      gate: o.gate as Record<string, unknown>,
      resolved_at: (o.resolved_at as string | null | undefined) ?? null,
      comment: (o.comment as string | null | undefined) ?? null,
      resolution: (o.resolution as Record<string, unknown> | null | undefined) ?? null,
    };
  }

  // Payload gate seul (kind, plan_public, …)
  if (typeof o.kind === "string" || o.plan_public != null || o.result_preview != null) {
    return { gate: o };
  }

  return null;
}

export function extractPlanPublicFromHitl(raw: unknown): Record<string, unknown> {
  const block = normalizeHitlBlock(raw);
  const gate = block?.gate || {};

  const direct = gate.plan_public;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const alt = gate.plan;
  if (alt && typeof alt === "object" && !Array.isArray(alt)) {
    return alt as Record<string, unknown>;
  }

  const preview = gate.result_preview;
  if (typeof preview === "string" && preview.trim()) {
    try {
      const parsed = JSON.parse(preview) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }

  return {};
}
