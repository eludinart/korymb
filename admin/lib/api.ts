const API_BASE = "/api/korymb";

type RequestOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  /** Si false, les erreurs HTTP ne lèvent pas — inspecter `res.ok` dans le retour. */
  expectOk?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/** Extrait un message lisible depuis les erreurs FastAPI (`detail` string, liste Pydantic, etc.). */
export function formatHttpApiErrorPayload(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const raw = d.detail ?? d.error ?? d.message;
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        if (item && typeof item === "object" && "loc" in item && "msg" in item) {
          return `${JSON.stringify((item as { loc: unknown }).loc)}: ${String((item as { msg: unknown }).msg)}`;
        }
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(raw).trim();
}

function isTransientNetworkError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "AbortError") return true;
  const msg = String(e.message || "").toLowerCase();
  return msg.includes("network") || msg.includes("failed to fetch") || msg.includes("timeout");
}

export function agentHeaders(extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}

export function apiUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function requestJson(path: string, options: RequestOptions = {}) {
  const {
    timeoutMs = 12000,
    retries = 0,
    expectOk = true,
    headers,
    ...fetchOptions
  } = options;
  let attempt = 0;
  while (true) {
    const { signal, cancel } = timeoutSignal(timeoutMs);
    try {
      const res = await fetch(apiUrl(path), {
        ...fetchOptions,
        headers: {
          "Cache-Control": "no-cache",
          ...(headers || {}),
        },
        cache: "no-store",
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (expectOk && !res.ok) {
        const msg = formatHttpApiErrorPayload(data);
        throw new Error(msg || `HTTP ${res.status}`);
      }
      return { res, data };
    } catch (err) {
      if (attempt < retries && isTransientNetworkError(err)) {
        attempt += 1;
        await sleep(350 * attempt);
        continue;
      }
      throw err;
    } finally {
      cancel();
    }
  }
}

type JsonLike = Record<string, unknown>;
type FallbackCall = () => Promise<{ res: Response; data: JsonLike }>;

export async function requestFallbackJson(calls: FallbackCall[], methodLabel: string) {
  const failures: string[] = [];
  for (const call of calls) {
    const out = await call();
    if (out.res.ok) return out;
    if (out.res.status === 404 || out.res.status === 405) {
      failures.push(`${out.res.status}`);
      continue;
    }
    throw new Error(formatHttpApiErrorPayload(out.data) || `${methodLabel}: HTTP ${out.res.status}`);
  }
  throw new Error(`${methodLabel}: endpoint indisponible (fallbacks ${failures.join(", ") || "n/a"})`);
}
