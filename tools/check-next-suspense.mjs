/**
 * Garde-fou Coolify / next build : toute page app qui appelle useSearchParams
 * doit exposer un boundary <Suspense> dans le même fichier (export default).
 *
 * Usage: node tools/check-next-suspense.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "admin", "app");
const offenders = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name === "page.tsx" || name === "page.ts" || name === "page.jsx") {
      const src = fs.readFileSync(full, "utf8");
      if (!src.includes("useSearchParams")) continue;
      if (!/\bSuspense\b/.test(src)) {
        offenders.push(path.relative(path.join(__dirname, ".."), full).replace(/\\/g, "/"));
      }
    }
  }
}

walk(root);

if (offenders.length) {
  console.error("Pages with useSearchParams but no Suspense boundary:");
  for (const f of offenders) console.error(" -", f);
  console.error("\nWrap the page content in <Suspense> (see /missions or /inbox).");
  process.exit(1);
}

console.log("OK — all useSearchParams pages declare Suspense.");
