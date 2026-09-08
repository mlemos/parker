import { describe, expect, it } from "vitest";
import written from "../../shared/design-tokens.json";
import { designTokens } from "./design-tokens";
import { THEMES } from "./themes";
import { ORDER } from "./todo-model";

// shared/design-tokens.json is what the iPhone companion paints from. It is
// generated, so the only way it can be wrong is by being stale — this fails the
// moment a theme or a glyph changes without the export being re-run.
describe("shared/design-tokens.json", () => {
  it("matches the tables in src/lib (run: node scripts/export-design-tokens.mjs)", () => {
    // Through JSON and back, so the comparison sees what the file can hold.
    expect(written).toEqual(JSON.parse(JSON.stringify(designTokens())));
  });

  it("carries every theme, every state and a glyph for every state but TODO", () => {
    const t = designTokens();
    expect(t.themes.map((x) => x.id)).toEqual(THEMES.map((x) => x.id));
    expect(t.themes.map((x) => x.id)).toContain(t.defaultThemeId);
    expect(t.todo.order).toEqual([...ORDER]);
    for (const st of ORDER) {
      const svg = t.todo.glyphs[st];
      if (st === "TODO") expect(svg).toBe(""); // the open box is empty on purpose
      else expect(svg.startsWith("<svg")).toBe(true);
    }
    for (const theme of t.themes)
      expect(Object.keys(theme.todo).sort()).toEqual(["attn", "doing", "done", "fail", "pause", "wait"]);
  });
});
