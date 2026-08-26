import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  THEMES,
  nextThemeId,
  themeById,
  type SyntaxColors,
  type ThemeUI,
  type TodoColors,
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

const TODO_ROLES = {
  doing: true, pause: true, wait: true, attn: true, done: true, fail: true,
} satisfies Record<keyof TodoColors, true>;

const isColor = (v: string) => /^(#[0-9a-f]{3,8}|rgba?\()/i.test(v);

/** How far two marks must sit from each other to read as two marks. */
const MIN_APART = 90;

/**
 * Weighted-RGB ("redmean") distance — a cheap stand-in for perceptual
 * distance, accurate enough to answer the only question asked of it: would
 * somebody tell these two 8px squares apart?
 */
function apart(a: string, b: string): number {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

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

      it("defines every to-do state as a color", () => {
        for (const role of Object.keys(TODO_ROLES) as (keyof TodoColors)[]) {
          expect(isColor(th.todo[role]), `${th.id}.todo.${role}`).toBe(true);
        }
      });

      it("keeps every mark on a line apart from every other", () => {
        // Identity was too weak a test: it passed Matrix, where PAUSE and
        // CANCEL were the same colour, because CANCEL isn't in TodoColors — it
        // takes ui.muted, so the collision lived across two role sets. And it
        // passed Blueprint, where PAUSE merely sat 21 units from CANCEL, which
        // at 8px is the same thing as identical.
        //
        // So: measure. Every state, plus CANCEL, must be MIN_APART from every
        // other. The four house themes clear this by construction — the
        // Tailwind ramp separates by hue — so the threshold only ever binds on
        // a guest theme whose whole world is one colour.
        const marks: Record<string, string> = { ...th.todo, cancel: th.ui.muted };
        const keys = Object.keys(marks);
        for (let i = 0; i < keys.length; i++)
          for (let j = i + 1; j < keys.length; j++) {
            const d = apart(marks[keys[i]], marks[keys[j]]);
            expect(d, `${th.id}: ${keys[i]} and ${keys[j]} are ${d.toFixed(0)} apart`)
              .toBeGreaterThanOrEqual(MIN_APART);
          }
      });

      it("does not hide a to-do state in the text around it", () => {
        // The bug that made the palette themeable: on a green-on-green theme
        // the house DONE was the same green as the body text.
        for (const role of Object.keys(TODO_ROLES) as (keyof TodoColors)[]) {
          expect(th.todo[role], `${th.id}.todo.${role}`).not.toBe(th.syntax.plain);
          expect(th.todo[role], `${th.id}.todo.${role}`).not.toBe(th.ui.editorBg);
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
