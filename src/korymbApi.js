/** Sans slash final. Retire un suffixe `/api` erroné (les routes FastAPI sont /jobs, /run… à la racine du service). */
export function normalizeViteBackendUrl(raw) {
  let u = (raw || "").trim().replace(/\/$/, "");
  if (!u) return "";
  // Ne pas toucher à https://exemple.com/api/v1/... — seulement « …/api » comme dernier segment.
  if (/^https?:\/\/.+\/api$/i.test(u) && !/\/api\/.+/i.test(u)) {
    return u.replace(/\/api$/i, "");
  }
  return u;
}

const remoteUrl = normalizeViteBackendUrl(import.meta.env.VITE_AI_BACKEND_URL || "");

/** Port par défaut aligné avec restart.ps1 / `.env` (évite 8010 et ses instances fantômes sous Windows). */
const LOCAL_BACKEND_FALLBACK = "http://127.0.0.1:8020";

/**
 * Base URL des appels API (toujours une URL absolue).
 * On n’utilise plus le préfixe `/api` + proxy Vite en local : une cible proxy erronée renvoyait un `/health`
 * obsolète (3.0.0) alors que uvicorn tournait déjà en 3.0.x sur 8020. En `development`, le backend expose CORS *.
 */
function devRewritePoisoned8010(url) {
  if (!import.meta.env.DEV || !url) return url;
  // Sur cette machine on a verifie : 8010 repond encore avec un /health minimal (3.0.0) en parallele du bon backend.
  // En dev, on refuse de cibler ce port pour eviter d afficher la mauvaise revision.
  if (/:8010\b/.test(url)) {
    const next = url.replace(/:8010\b/, ":8020");
    if (next !== url) {
      // eslint-disable-next-line no-console
      console.warn("[korymb] Dev: port 8010 evite (souvent une instance fantome) ->", next);
    }
    return next;
  }
  return url;
}

const apiTrimmed = devRewritePoisoned8010((remoteUrl || "").trim().replace(/\/$/, ""));
export const API = (apiTrimmed || LOCAL_BACKEND_FALLBACK).replace(/\/$/, "");

const SECRET = (import.meta.env.VITE_AGENT_SECRET || "").trim();

export function authHeaders() {
  return { "Content-Type": "application/json", "X-Agent-Secret": SECRET };
}
