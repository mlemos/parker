import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  THEMES,
  nextThemeId,
  themeById,
  type SyntaxColors,
  type ThemeUI,
} from "./themes.ts";

// `satisfies` keeps these lists honest: add a role to ThemeUI or SyntaxColors
// and the typecheck fails here until the new role is listed — which is the
// point, because a role a theme forgets to define renders as nothing at all.
const UI_ROLES = {
  editorBg: true, editorFg: true, currentLine: true, selection: true,
  headerBg: true, fieldBg: true, tabbarBg: true, tabActiveBg: true,
  statusBg: true, popoverBg: true, text: true, secondary: true, muted: true,
  border: true, accent: true, onAccent: true, danger: true,
} satisfies Record<keyof ThemeUI, true>;

const SYNTAX_ROLES = {
  plain: true, heading: true, bold: true, italic: true, list: true,
  inlineCode: true, keyword: true, string: true, number: true, func: true,
  comment: true, punct: true, link: true, invalid: true,
} satisfies Record<keyof SyntaxColors, true>;

const isColor = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\()/i.test(v);

describe("the theme registry", () => {
  it("has themes, with unique ids", () => {
    expect(THEMES.length).toBeGreaterThan(0);
    expect(new Set(THEMES.map((th) => th.id)).size).toBe(THEMES.length);
  });

  it("defaults to a theme that exists, and lists it first", () => {
    expect(THEMES.some((th) => th.id === DEFAULT_THEME_ID)).toBe(true);
    // themeById falls back to THEMES[0], so the two must not drift apart.
    expect(THEMES[0].id).toBe(DEFAULT_THEME_ID);
  });

  for (const th of THEMES) {
    describe(th.id, () => {
      it("is labelled and declares a mode", () => {
        expect(th.label.trim()).not.toBe("");
        expect(["light", "dark"]).toContain(th.mode);
        expect(th.cm).toBeDefined();
      });

      it("defines every UI role as a color", () => {
        for (const role of Object.keys(UI_ROLES) as (keyof ThemeUI)[]) {
          expect(th.ui[role], `${th.id}.ui.${role}`).toBeTypeOf("string");
          expect(isColor(th.ui[role]), `${th.id}.ui.${role} = ${th.ui[role]}`).toBe(true);
        }
      });

      it("defines every syntax role as a color", () => {
        for (const role of Object.keys(SYNTAX_ROLES) as (keyof SyntaxColors)[]) {
          expect(isColor(th.syntax[role]), `${th.id}.syntax.${role}`).toBe(true);
        }
      });

      it("does not paint text the same color as the surface under it", () => {
        expect(th.ui.editorFg).not.toBe(th.ui.editorBg);
        expect(th.ui.text).not.toBe(th.ui.headerBg);
        expect(th.syntax.plain).not.toBe(th.ui.editorBg);
      });
    });
  }
});

describe("themeById", () => {
  it("finds a known theme", () => {
    expect(themeById("vercel-day").id).toBe("vercel-day");
  });

  it("falls back to the default for anything it doesn't know", () => {
    for (const id of ["gone", "", null, undefined])
      expect(themeById(id).id).toBe(DEFAULT_THEME_ID);
  });
});

describe("nextThemeId", () => {
  it("visits every theme once and comes back to the start", () => {
    const seen: string[] = [];
    let id = DEFAULT_THEME_ID;
    do {
      seen.push(id);
      id = nextThemeId(id);
    } while (id !== DEFAULT_THEME_ID && seen.length <= THEMES.length + 1);
    expect(seen).toEqual(THEMES.map((th) => th.id));
  });

  it("recovers from an id that is no longer in the registry", () => {
    expect(nextThemeId("removed-in-an-older-version")).toBe(THEMES[0].id);
  });
});
