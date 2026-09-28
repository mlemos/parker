// shared/parker-paint.js — the note painter the iPhone runs — must be what
// src/lib/paint.ts builds to today.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";
import { paintBundleConfig } from "./paint-bundle.config.mjs";

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

it("shared/parker-paint.js is fresh (run: node scripts/export-note-paint.mjs)", async () => {
  const out = await build(paintBundleConfig(root(".")));
  const code = (Array.isArray(out) ? out[0] : out).output[0].code;
  expect(readFileSync(root("shared/parker-paint.js"), "utf8") === code).toBe(true);
}, 60_000);
