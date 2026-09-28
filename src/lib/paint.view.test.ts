// @vitest-environment jsdom
// The note painter (paint.ts) — what the iPhone paints with — against the
// Mac's real editor: the same notes in a CodeMirror view built as Editor.tsx
// builds it, every character's classes read off the DOM, and the two must say
// the same thing, line by line. Plus the fixture the iPhone reads must be
// fresh (the bundle's freshness is scripts/paint-bundle.test.mjs, outside jsdom).
import { markdown } from "@codemirror/lang-markdown";
import { highlightingFor } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import type { Tag } from "@lezer/highlight";
import { EditorView, getDefaultExtensions } from "@uiw/react-codemirror";
import { afterEach, describe, expect, it } from "vitest";
import { followLinks } from "./links";
import { noteExtensions } from "./md-tags";
import { MARK_ORDER, SYNTAX_ORDER, paintNote } from "./paint";
import type { LinePaint, PaintRole, PaintRun } from "./paint";
import { PAINT_CASES } from "./paint-cases";
import { fixture, serializeFixture } from "./paint-entry";
import { monoStyleTags, THEMES } from "./themes";
import { todoHighlighter } from "./todo";

import appCss from "../App.css?raw";
import fixtureText from "../../shared/fixtures/note-paint.json?raw";
import bundle from "../../shared/parker-paint.js?raw";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

// The editor's markdown without the languages nested in a note (named code
// fences, HTML), which it loads lazily and the painter leaves as fence text.
function open(note: string): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc: note,
      extensions: [
        getDefaultExtensions({ basicSetup: { syntaxHighlighting: false } }),
        THEMES[0].cm,
        markdown({ extensions: noteExtensions }),
        todoHighlighter,
        followLinks,
      ],
    }),
    parent: document.body,
  });
  return view;
}

const MD_CLASSES: [string, PaintRole][] = [
  ["cm-md-em", "italic"],
  ["cm-md-strong", "bold"],
  ["cm-md-code", "code"],
  ["cm-md-strike", "strike"],
  ["cm-md-highlight", "highlight"],
  ["cm-md-link", "link"],
  ["cm-md-url", "url"],
];
const SYNTAX_TAGS: [Tag, PaintRole][] = [
  [t.comment, "comment"],
  [t.string, "string"],
  [t.labelName, "label"],
  [t.heading, "heading"],
  [t.heading1, "heading"],
  [t.heading2, "heading"],
  [t.heading6, "heading"],
  [t.quote, "quote"],
  [t.monospace, "fence"],
  [t.list, "list"],
];

// App.css's rules for colour in the editor, as selectors: [specificity,
// order, role, does it match this element]. The same cascade the browser runs,
// written down independently of the painter's precedence — so a wrong
// precedence in paint.ts shows up here as a difference.
type Rule = [number, number, PaintRole, (e: Element, line: Element) => boolean];
function cssRules(css: string, syntax: Map<string, PaintRole>, syntaxOrder: string[]): Rule[] {
  const has = (e: Element, c: string) => e.classList.contains(c);
  const inChild = (line: Element) => Array.from(line.classList).some((c) => c.startsWith("cm-todo-child-"));
  const onTodo = (line: Element) => Array.from(line.classList).some((c) => c.startsWith("cm-todo-line-") || c.startsWith("cm-todo-child-"));
  const pos = (sel: string) => {
    const i = css.indexOf(sel);
    if (i < 0) throw new Error(`App.css has no ${sel}`);
    return i;
  };
  const rules: Rule[] = [];
  // The theme's classes: specificity 0,1,0, later rule wins (monoStyles order).
  for (const [cls, role] of syntax) rules.push([10, syntaxOrder.indexOf(cls), role, (e) => has(e, cls)]);
  // .cm-todo-line-x span, .cm-todo-child-x span: 0,1,1.
  rules.push([11, 0, "line", (e, line) => e.tagName === "SPAN" && onTodo(line)]);
  // The marks: .editor-wrap .cm-md-x 0,2,0; em.strong 0,3,0. Under a to-do,
  // one class more.
  for (const [cls, role] of MD_CLASSES) {
    rules.push([20, pos(`.editor-wrap .${cls} {`), role, (e, line) => has(e, cls) && !inChild(line)]);
    rules.push([30, pos(`.editor-wrap [class*="cm-todo-child-"] .${cls}`), role, (e, line) => has(e, cls) && inChild(line)]);
  }
  rules.push([30, pos(".editor-wrap .cm-md-em.cm-md-strong {"), "boldItalic", (e, line) => has(e, "cm-md-em") && has(e, "cm-md-strong") && !inChild(line)]);
  rules.push([40, pos('.editor-wrap [class*="cm-todo-child-"] .cm-md-em.cm-md-strong'), "boldItalic", (e, line) => has(e, "cm-md-em") && has(e, "cm-md-strong") && inChild(line)]);
  // Bare urls: .cm-editor .cm-ext-url 0,2,0 and .editor-wrap .cm-ext-url span
  // 0,2,1; under a to-do 0,3,0 and 0,3,1.
  const inBare = (e: Element) => e.tagName === "SPAN" && !!e.parentElement?.closest(".cm-ext-url");
  rules.push([20, pos(".cm-editor .cm-ext-url {"), "url", (e, line) => has(e, "cm-ext-url") && !inChild(line)]);
  rules.push([21, pos(".editor-wrap .cm-ext-url span {"), "url", (e, line) => inBare(e) && !inChild(line)]);
  rules.push([30, pos('.editor-wrap [class*="cm-todo-child-"] .cm-ext-url,'), "url", (e, line) => has(e, "cm-ext-url") && inChild(line)]);
  rules.push([31, pos('.editor-wrap [class*="cm-todo-child-"] .cm-ext-url span'), "url", (e, line) => inBare(e) && inChild(line)]);
  return rules;
}

/** The Mac's paint, read off the view: for each character, the colour rule
 *  that wins on the innermost element any rule matches (the browser's
 *  cascade), or the line's own colour. */
function domPaint(v: EditorView): LinePaint[] {
  const syntax = new Map<string, PaintRole>();
  const syntaxOrder: string[] = [];
  for (const [tag, role] of SYNTAX_TAGS) {
    const cls = highlightingFor(v.state, [tag]);
    if (cls) for (const c of cls.split(" ")) syntax.set(c, role);
  }
  // A theme class's place among the theme's rules: monoStyles order.
  for (const tags of monoStyleTags())
    for (const tag of tags) {
      const cls = highlightingFor(v.state, [tag]);
      if (cls) for (const c of cls.split(" ")) if (!syntaxOrder.includes(c)) syntaxOrder.push(c);
    }
  const rules = cssRules(appCss, syntax, syntaxOrder);
  const doc = v.state.doc;
  const out: LinePaint[] = [];
  for (let n = 1; n <= doc.lines; n++) out.push({ tone: "", tag: null, runs: [] });
  const seen = Array.from({ length: doc.lines }, () => new Set<number>());

  for (const lineEl of Array.from(v.contentDOM.querySelectorAll(".cm-line"))) {
    const line = doc.lineAt(v.posAtDOM(lineEl, 0));
    const paint = out[line.number - 1];
    const cls = Array.from(lineEl.classList).find((c) => c.startsWith("cm-todo-line-") || c.startsWith("cm-todo-child-"));
    paint.tone = cls ? cls.replace("cm-todo-line-", "todo-").replace("cm-todo-child-", "child-") : "";
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement!;
      if (el.closest(".cm-todo-box")) continue;
      let role: PaintRole | null = null;
      for (let e: Element | null = el; e && e !== lineEl && !role; e = e.parentElement) {
        const hits = rules.filter(([, , , match]) => match(e!, lineEl));
        if (hits.length) role = hits.sort((x, y) => x[0] - y[0] || x[1] - y[1])[hits.length - 1][2];
      }
      role ??= paint.tone ? "line" : "plain";
      // The face: font-weight / font-style / text-decoration / background of
      // the element or one it sits in (App.css .cm-md-*, .cm-ext-url; the
      // theme's heading weight and comment style).
      const up = (test: (e: Element) => boolean) => {
        for (let e: Element | null = el; e && e !== lineEl; e = e.parentElement) if (test(e)) return true;
        return false;
      };
      const hasSyntax = (e: Element, r: PaintRole) => Array.from(e.classList).some((c) => syntax.get(c) === r);
      const face: Omit<PaintRun, "from" | "to" | "role"> = {};
      if (up((e) => e.classList.contains("cm-md-strong") || hasSyntax(e, "heading"))) face.bold = true;
      if (up((e) => e.classList.contains("cm-md-em") || hasSyntax(e, "comment"))) face.italic = true;
      if (up((e) => ["cm-md-link", "cm-md-url", "cm-ext-url"].some((c) => e.classList.contains(c)))) face.underline = true;
      const washEl = el.closest(".cm-md-code, .cm-md-highlight");
      if (washEl && lineEl.contains(washEl)) face.wash = washEl.classList.contains("cm-md-code") ? "code" : "highlight";
      const text = node.textContent ?? "";
      for (let k = 0; k < text.length; k++) {
        const i = v.posAtDOM(node, k) - line.from;
        seen[line.number - 1].add(i);
        const last = paint.runs[paint.runs.length - 1];
        const run: PaintRun = { from: i, to: i + 1, role, ...face };
        if (last && last.to === i && JSON.stringify({ ...last, from: 0, to: 0 }) === JSON.stringify({ ...run, from: 0, to: 0 })) last.to = i + 1;
        else paint.runs.push(run);
      }
    }
    // What the view doesn't show as text is the to-do's tag, under its box.
    const hidden = Array.from({ length: line.length }, (_, i) => i).filter((i) => !seen[line.number - 1].has(i));
    paint.tag = hidden.length ? [hidden[0], hidden[hidden.length - 1] + 1] : null;
  }
  return out;
}

const readable = (note: string, lines: LinePaint[]) =>
  lines.map((l, i) => {
    const text = note.split("\n")[i];
    return `${l.tone || "-"} ${l.tag ? `[${text.slice(...l.tag)}] ` : ""}${l.runs.map((r: PaintRun) => `${r.role}${r.bold ? "+b" : ""}${r.italic ? "+i" : ""}${r.underline ? "+u" : ""}${r.wash ? `+${r.wash}` : ""}:${JSON.stringify(text.slice(r.from, r.to))}`).join(" ")}`;
  });

describe("the note painter against the Mac's editor", () => {
  for (const c of PAINT_CASES)
    it(`paints "${c.name}" as the editor does`, () => {
      const v = open(c.note);
      expect(readable(c.note, paintNote(c.note))).toEqual(readable(c.note, domPaint(v)));
    });
});

describe("the precedence the painter uses is the stylesheets'", () => {
  it("marks: the order of the .cm-md-* rules in App.css, under a to-do too", () => {
    const css = appCss;
    const byRole: Record<string, string> = {
      italic: "cm-md-em",
      bold: "cm-md-strong",
      code: "cm-md-code",
      link: "cm-md-link",
      url: "cm-md-url",
      highlight: "cm-md-highlight",
      strike: "cm-md-strike",
    };
    for (const prefix of [".editor-wrap .", '.editor-wrap [class*="cm-todo-child-"] .']) {
      const at = MARK_ORDER.map((role) => css.indexOf(`${prefix}${byRole[role]}`));
      expect(at.every((x) => x >= 0), prefix).toBe(true);
      expect([...at].sort((a, b) => a - b), prefix).toEqual(at);
    }
  });

  it("syntax: the order of themes.ts monoStyles", () => {
    const order = monoStyleTags();
    const first: Record<string, Tag> = {
      comment: t.comment,
      string: t.string,
      label: t.labelName,
      heading: t.heading,
      quote: t.quote,
      fence: t.monospace,
      list: t.list,
    };
    const at = SYNTAX_ORDER.map((role) => order.findIndex((tags) => tags.includes(first[role])));
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe("what the iPhone gets", () => {
  it("shared/fixtures/note-paint.json is fresh (run: node scripts/export-note-paint.mjs)", () => {
    expect(fixtureText).toBe(serializeFixture(fixture()));
  });

  it("the bundle runs as one plain script with a global ParkerPaint, as JavaScriptCore will run it", () => {
    const run = new Function(`${bundle}; return ParkerPaint;`) as () => { paint(text: string): string };
    const note = PAINT_CASES[0].note;
    expect(JSON.parse(run().paint(note))).toEqual(paintNote(note));
  });
});
