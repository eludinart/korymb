/**
 * Verifie que GET /health correspond au backend du depot (version + code_dir).
 * Usage : npm run verify:api   (depuis la racine tarot.app)
 * Contourner : KORYMB_SKIP_VERIFY=1 npm run dev   (frontend sans backend)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.KORYMB_SKIP_VERIFY === "1") {
  console.log("[verify:api] ignore (KORYMB_SKIP_VERIFY=1)");
  process.exit(0);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvValue(key) {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

function readBackendVersion() {
  const vp = path.join(root, "backend", "version.py");
  if (!fs.existsSync(vp)) return "";
  const m = fs.readFileSync(vp, "utf8").match(/BACKEND_VERSION\s*=\s*["']([^"']+)["']/);
  return m ? m[1].trim() : "";
}

const expected = readBackendVersion();
let base = readEnvValue("VITE_AI_BACKEND_URL").replace(/\/$/, "");
if (!base) base = "http://127.0.0.1:8020";

const attempts = 12;
const delayMs = 800;

let lastRes = null;
let lastData = null;
let lastEffective = "";

for (let attempt = 1; attempt <= attempts; attempt++) {
  const url = `${base}/health?_=${Date.now()}`;
  let res;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
  } catch (e) {
    console.error(`[verify:api] Impossible de joindre ${base}/health`);
    console.error(e?.message || e);
    process.exit(1);
  }

  lastRes = res;
  if (!res.ok) {
    console.error(`[verify:api] HTTP ${res.status} sur ${url}`);
    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    process.exit(1);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error(`[verify:api] Corps non-JSON sur ${url}`);
    process.exit(1);
  }

  lastData = data;
  const hdr = res.headers.get("X-Korymb-Version") || res.headers.get("x-korymb-version") || "";
  const ver = String(data.version ?? "").trim();
  const rev = String(data.revision ?? "").trim();
  const codeDir = data.code_dir != null ? String(data.code_dir) : "";

  if (!codeDir) {
    console.error(
      `[verify:api] Reponse /health minimale (pas de code_dir). Souvent une vieille instance sur le meme port que ${base}.`,
    );
    console.error(`[verify:api] Corps : ${JSON.stringify(data)}`);
    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    process.exit(1);
  }

  const effective = (hdr && hdr.trim()) || rev || ver;
  lastEffective = effective;
  if (!expected || effective === expected) {
    console.log(`[verify:api] OK ${base}/health -> ${effective} (${codeDir}) [${attempt}/${attempts}]`);
    process.exit(0);
  }

  console.error(
    `[verify:api] Ecart version : attendu ${expected} ; recu ${effective} (tentative ${attempt}/${attempts}, code_dir OK).`,
  );
  if (attempt < attempts) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

console.error(
  `[verify:api] Version attendue (backend/version.py) : ${expected} ; /health : ${lastEffective} ; base : ${base}`,
);
if (lastData?.code_dir) console.error(`[verify:api] code_dir : ${lastData.code_dir}`);
console.error(
  `[verify:api] Le processus sur ce port sert encore une ancienne build. Depuis le depot : cd backend ; .\\restart.ps1 puis relance npm run dev.`,
);
process.exit(1);
