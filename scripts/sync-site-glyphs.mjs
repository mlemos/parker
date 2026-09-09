// Copy the to-do glyphs into the site's features page — the interactive demo
// draws the app's checkboxes, so it must draw exactly what the app draws.
// Source of truth: shared/design-tokens.json (itself generated from src/lib by
// export-design-tokens.mjs). Rewrites the `var G = {...}` block in
// site/script.js and each row's initial glyph in site/features/index.html.
//
//   node scripts/export-design-tokens.mjs && node scripts/sync-site-glyphs.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const tokens = JSON.parse(readFileSync(at("../shared/design-tokens.json"), "utf8"));
const glyphs = tokens.todo.glyphs; // state → svg markup ("" for TODO)
const kinds = Object.fromEntries(tokens.todo.order.map((st) => [st.toLowerCase(), glyphs[st]]));

// site/script.js — the G table, as literal strings
const js = at("../site/script.js");
let script = readFileSync(js, "utf8");
const gBlock = /    var G = \{[\s\S]*?\n    \};\n/;
if (!gBlock.test(script)) throw new Error("site/script.js: `var G = {...};` block not found");
const table =
  "    var G = {\n" +
  Object.entries(kinds).map(([k, svg]) => `      ${k}: ${JSON.stringify(svg)}`).join(",\n") +
  "\n    };\n";
script = script.replace(gBlock, table);
// the old g() helper, if still there, has nothing to do
script = script.replace(/\n    function g\(transform, width, shapes\) \{[\s\S]*?\n    \}\n/, "\n");
writeFileSync(js, script);

// site/features/index.html — each row's initial glyph
const html = at("../site/features/index.html");
let page = readFileSync(html, "utf8");
let rows = 0;
page = page.replace(
  /(<div class="todo-row" data-state="([a-z]+)">[\s\S]*?<span class="tglyph">)([\s\S]*?)(<\/span>)/g,
  (_m, head, state, _old, tail) => {
    if (!(state in kinds)) throw new Error(`features page: unknown state ${state}`);
    rows++;
    return head + kinds[state] + tail;
  }
);
if (rows === 0) throw new Error("features page: no to-do rows found");
writeFileSync(html, page);
console.log(`site glyphs synced — ${Object.keys(kinds).length} states in script.js, ${rows} rows in features/index.html`);
