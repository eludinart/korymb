#!/usr/bin/env node
/**
 * Génère admin/lib/api-schema.d.ts depuis le schéma OpenAPI FastAPI.
 * Prérequis : backend démarré sur KORYMB_API_URL (défaut http://127.0.0.1:8020).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.KORYMB_API_URL || "http://127.0.0.1:8020").replace(/\/$/, "");
const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "admin", "lib", "api-schema.d.ts");

async function main() {
  const res = await fetch(`${base}/openapi.json`);
  if (!res.ok) {
    console.error(`openapi.json indisponible (${res.status}) — démarrez le backend : ${base}`);
    process.exit(1);
  }
  const schema = await res.json();
  const header = `/* eslint-disable */\n/** Auto-généré depuis ${base}/openapi.json — npm run generate:api-schema */\n\n`;
  const body = `export interface OpenApiPaths {\n  [path: string]: Record<string, unknown>;\n}\n\nexport type OpenApiSchema = ${JSON.stringify(schema, null, 2)};\n`;
  writeFileSync(outPath, header + body, "utf8");
  console.log(`Écrit : ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
