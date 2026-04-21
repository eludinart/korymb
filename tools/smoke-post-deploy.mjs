#!/usr/bin/env node

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

async function checkHttpOk(url, label) {
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!(res.status >= 200 && res.status < 500)) {
    throw new Error(`${label}: HTTP ${res.status}`);
  }
  console.log(`[smoke] OK ${label}: HTTP ${res.status}`);
  return res;
}

async function main() {
  const args = parseArgs(process.argv);
  const appUrl = normalizeBase(args["app-url"] || process.env.SMOKE_APP_URL);
  const backendUrl = normalizeBase(args["backend-url"] || process.env.SMOKE_BACKEND_URL);
  const checkAdminProxy = Boolean(args["check-admin-proxy"]);

  if (!appUrl) {
    throw new Error("Missing --app-url (or SMOKE_APP_URL).");
  }

  const routes = [
    "/dashboard",
    "/configuration",
    "/administration",
    "/missions",
    "/chat",
    "/historique",
    "/mission/nouvelle",
    "/mission/guided",
  ];

  for (const route of routes) {
    await checkHttpOk(`${appUrl}${route}`, `frontend ${route}`);
  }

  if (backendUrl) {
    const health = await checkHttpOk(`${backendUrl}/health`, "backend /health");
    const data = await health.json().catch(() => ({}));
    if (!data || typeof data !== "object") {
      throw new Error("backend /health returned invalid JSON.");
    }
    console.log(`[smoke] backend revision: ${String(data.revision || data.version || "unknown")}`);
  } else {
    console.log("[smoke] backend check skipped (no --backend-url).");
  }

  if (checkAdminProxy) {
    const res = await checkHttpOk(`${appUrl}/api/korymb-admin`, "frontend proxy /api/korymb-admin");
    const data = await res.json().catch(() => ({}));
    const provider = data?.llm_provider;
    if (!provider) {
      throw new Error("admin proxy JSON missing llm_provider.");
    }
    console.log(`[smoke] admin proxy provider: ${String(provider)}`);
  }

  console.log("[smoke] ALL CHECKS PASSED");
}

main().catch((err) => {
  console.error(`[smoke] FAILED: ${err?.message || err}`);
  process.exit(1);
});
