// Write the note painter for the iPhone — shared/parker-paint.js, src/lib/
// paint.ts bundled into one script for JavaScriptCore — and the fixture both
// apps are tested against, shared/fixtures/note-paint.json.
//
//   node scripts/export-note-paint.mjs
//
// src/lib/paint.view.test.ts fails while either is stale.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { paintBundleConfig } from "./paint-bundle.config.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

const out = await build(paintBundleConfig(root(".")));
const code = (Array.isArray(out) ? out[0] : out).output[0].code;
writeFileSync(root("shared/parker-paint.js"), code);

const server = await createServer({
  configFile: root("vite.config.ts"),
  server: { middlewareMode: true, hmr: false, watch: null },
  logLevel: "silent",
  appType: "custom",
});
try {
  const mod = await server.ssrLoadModule("/src/lib/paint-entry.ts");
  const f = mod.fixture();
  writeFileSync(root("shared/fixtures/note-paint.json"), mod.serializeFixture(f));
  console.log(`wrote shared/parker-paint.js (${Math.round(code.length / 1024)} KB) and shared/fixtures/note-paint.json (${f.cases.length} cases)`);
} finally {
  await server.close();
}
