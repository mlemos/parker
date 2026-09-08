// Write shared/design-tokens.json — the eight themes, the to-do grammar and the
// to-do glyphs — for the iPhone companion to paint from. The tokens themselves
// are assembled in src/lib/design-tokens.ts from the same tables the Mac
// renders; this only loads that TypeScript through Vite and writes the file.
//
//   node scripts/export-design-tokens.mjs
//
// src/lib/design-tokens.test.ts fails while the file is stale.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const OUT = fileURLToPath(new URL("../shared/design-tokens.json", import.meta.url));

const server = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true, hmr: false, watch: null },
  logLevel: "silent",
  appType: "custom",
});
try {
  const mod = await server.ssrLoadModule("/src/lib/design-tokens.ts");
  const tokens = mod.designTokens();
  writeFileSync(OUT, mod.serializeTokens(tokens));
  console.log(
    `wrote shared/design-tokens.json — ${tokens.themes.length} themes, ${Object.keys(tokens.todo.glyphs).length} glyphs`
  );
} finally {
  await server.close();
}
