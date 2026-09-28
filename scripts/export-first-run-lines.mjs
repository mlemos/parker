// Write shared/fixtures/first-run-lines.json — the iPhone's first-run
// sentences for every situation (src/lib/first-run-iphone.ts), for ParkerCore's
// tests.   node scripts/export-first-run-lines.mjs
// src/lib/first-run.test.ts fails while it is stale.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const server = await createServer({
  configFile: root("vite.config.ts"),
  server: { middlewareMode: true, hmr: false, watch: null },
  logLevel: "silent",
  appType: "custom",
});
try {
  const mod = await server.ssrLoadModule("/src/lib/first-run-iphone.ts");
  const f = mod.phoneFixture();
  writeFileSync(root("shared/fixtures/first-run-lines.json"), JSON.stringify(f, null, 1) + "\n");
  console.log(`wrote shared/fixtures/first-run-lines.json (${f.cases.length} cases)`);
} finally {
  await server.close();
}
