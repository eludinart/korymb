#!/usr/bin/env node
/**
 * Contrôle P0 écosystème Élude In Art (HTTP public, sans SSH).
 *
 *   npm run smoke:p0
 *
 * Ne modifie rien. Échoue si un service critique ne répond pas, ou si
 * MariaDB Korymb n'est pas joignable via GET /health/database.
 */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function normalizeBase(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function expectStatus(url, label, allowed, { method = "GET", redirect = "manual" } = {}) {
  const res = await fetchWithTimeout(url, { method, redirect });
  const ok = allowed.includes(res.status);
  const loc = res.headers.get("location") || "";
  if (!ok) {
    throw new Error(`${label}: HTTP ${res.status} (attendu ${allowed.join("|")}) ${url}`);
  }
  console.log(`[p0] OK ${label}: HTTP ${res.status}${loc ? ` → ${loc}` : ""}`);
  return res;
}

async function main() {
  const args = parseArgs(process.argv);
  const korymbApp = normalizeBase(args["app-url"] || process.env.SMOKE_APP_URL || "https://korymb.eludein.art");
  const korymbApi = normalizeBase(
    args["backend-url"] || process.env.SMOKE_BACKEND_URL || "https://api-korymb.eludein.art",
  );
  const fleurApp = normalizeBase(args["fleur-url"] || "https://app-fleurdamours.eludein.art");
  const hermes = normalizeBase(args["hermes-url"] || "https://hermes.eludein.art");
  const hermesWebui = normalizeBase(args["hermes-webui-url"] || "https://hermeswebui.eludein.art");
  const site = normalizeBase(args["site-url"] || "https://eludein.art");

  await expectStatus(`${korymbApp}/`, "Korymb /", [200], { redirect: "follow" });
  await expectStatus(`${korymbApp}/login`, "Korymb /login", [200], { redirect: "follow" });

  const health = await expectStatus(`${korymbApi}/health`, "Korymb API /health", [200], { redirect: "follow" });
  const healthBody = await health.json().catch(() => ({}));
  if (healthBody?.status !== "ok") {
    throw new Error(`Korymb API /health status=${String(healthBody?.status)}`);
  }
  console.log(`[p0] Korymb API version ${String(healthBody.version || "?")} (connected=${String(healthBody?.database?.connected)})`);

  const dbRes = await expectStatus(`${korymbApi}/health/database`, "Korymb API /health/database", [200], {
    redirect: "follow",
  });
  const dbBody = await dbRes.json().catch(() => ({}));
  if (dbBody?.database?.connected !== true) {
    throw new Error(`/health/database connected=${JSON.stringify(dbBody?.database || dbBody)}`);
  }
  console.log(
    `[p0] MariaDB ${String(dbBody.database.engine)} ${String(dbBody.database.host)}/${String(dbBody.database.database)} connected=true`,
  );

  await expectStatus(`${fleurApp}/`, "Fleur /", [200, 301, 302, 307, 308]);
  await expectStatus(`${fleurApp}/jardin`, "Fleur /jardin", [200], { redirect: "follow" });

  await expectStatus(`${hermes}/`, "Hermes dashboard", [200, 302, 303, 307]);
  const webuiHealth = await expectStatus(`${hermesWebui}/health`, "Hermes WebUI /health", [200], {
    redirect: "follow",
  });
  const webuiBody = await webuiHealth.json().catch(() => ({}));
  if (webuiBody?.status && webuiBody.status !== "ok") {
    throw new Error(`Hermes WebUI /health status=${String(webuiBody.status)}`);
  }
  console.log(`[p0] Hermes WebUI status=${String(webuiBody.status || "ok")} sessions=${String(webuiBody.sessions ?? "?")}`);

  await expectStatus(`${site}/`, "eludein.art /", [200], { redirect: "follow" });

  console.log("[p0] ALL CHECKS PASSED");
  console.log("[p0] SSH VPS non couvert ici — docker compose / crons / backups : docs/ADMINISTRATION.md");
}

main().catch((err) => {
  console.error(`[p0] FAILED: ${err?.message || err}`);
  process.exit(1);
});
