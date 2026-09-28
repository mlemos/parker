// The note painter: what colour role every character of a note wears, as the
// Mac's editor paints it — computed from the text alone, with no DOM. The Mac
// doesn't use it to paint (CodeMirror and App.css do that); the iPhone does:
// it runs this file, bundled (shared/parker-paint.js), in JavaScriptCore, so a
// note is parsed by the same parser and painted by the same rules on both.
// paint.view.test.ts checks it against the Mac's real editor, character by
// character, over shared/fixtures/note-paint.json, which the iPhone's tests
// read too.
//
// The rules, in App.css's terms (the cascade, with its specificities):
//   - Syntax colours are the theme's classes for a node's tags (themes.ts
//     monoStyles); when a span has two, the later rule wins.
//   - The marks — italic, bold, code, links, urls, strike, highlight — are
//     classes of their own (.editor-wrap .cm-md-*) and beat syntax colours;
//     bold-italic beats every other mark.
//   - A bare url's text is the url colour whatever it sits in
//     (.editor-wrap .cm-ext-url span).
//   - On a to-do line, and on a line nested under a to-do, every other span
//     wears the line's colour (.cm-todo-line-x span, .cm-todo-child-x span).
//
// What it leaves out: languages nested in a note — HTML, and a code fence that
// names a language, whose text the Mac highlights as that language once it
// has loaded it. Here that text is fence text.
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import { highlightTag, inlineCodeTag, noteParser } from "./md-tags";
import { LINE_TAG, norm, ownersForRange } from "./todo-model";
import type { DocLike, DocLine, State } from "./todo-model";
import { externalUrl, LINK_NODES, scanUrls } from "./urls";

export type PaintRole =
  | "plain"
  | "comment"
  | "string"
  | "label"
  | "heading"
  | "quote"
  | "fence"
  | "list"
  | "italic"
  | "bold"
  | "boldItalic"
  | "code"
  | "link"
  | "url"
  | "highlight"
  | "strike"
  | "line"; // the to-do line's state colour, or its to-do's, dimmed, under one

export interface PaintRun {
  /** UTF-16 offsets in the line, as the file has it. */
  from: number;
  to: number;
  role: PaintRole;
}

export interface LinePaint {
  /** "todo-<state>" on a to-do line (an open /TODO has none), "child-<state>"
   *  on a line nested under a to-do, else "". */
  tone: string;
  /** Where the to-do's tag is — drawn as a box, not as text — or null. */
  tag: [number, number] | null;
  /** The rest of the line, each character once, in order. */
  runs: PaintRun[];
}

// themes.ts monoStyles, in its order (a later rule wins where two apply), with
// a role for a class. Syntax colours only: the tags a note's markdown carries.
const SYNTAX: [Parameters<typeof tagHighlighter>[0][number]["tag"], PaintRole][] = [
  [[t.comment, t.lineComment, t.blockComment, t.docComment], "comment"],
  [[t.string, t.special(t.string), t.regexp], "string"],
  [[t.function(t.variableName), t.function(t.propertyName), t.labelName], "label"],
  [[t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], "heading"],
  [[t.quote], "quote"],
  [[t.monospace], "fence"],
  [[t.list], "list"],
];
// The mark classes (monoStyles' `class:` rules, dressed by App.css).
const MARKS: [Parameters<typeof tagHighlighter>[0][number]["tag"], PaintRole][] = [
  [t.emphasis, "italic"],
  [t.strong, "bold"],
  [inlineCodeTag, "code"],
  [t.strikethrough, "strike"],
  [highlightTag, "highlight"],
  [t.link, "link"],
  [t.url, "url"],
];

const highlighter = tagHighlighter([...SYNTAX, ...MARKS].map(([tag, role]) => ({ tag, class: role })));

/** Syntax colours, a later one winning: the order the rules come in. */
export const SYNTAX_ORDER: PaintRole[] = SYNTAX.map(([, role]) => role);
/** The marks by App.css precedence, weakest first — the order of the
 *  .editor-wrap .cm-md-* rules (paint.view.test.ts reads it back from
 *  App.css). Bold-italic, a class pair, outranks them all. */
export const MARK_ORDER: PaintRole[] = ["italic", "bold", "code", "link", "url", "highlight", "strike"];

export function resolve(roles: Set<PaintRole>, bareUrl: boolean, onTodo: boolean): PaintRole {
  if (roles.has("italic") && roles.has("bold")) return "boldItalic";
  if (bareUrl) return "url";
  for (let i = MARK_ORDER.length - 1; i >= 0; i--) if (roles.has(MARK_ORDER[i])) return MARK_ORDER[i];
  if (onTodo) return "line";
  for (let i = SYNTAX_ORDER.length - 1; i >= 0; i--) if (roles.has(SYNTAX_ORDER[i])) return SYNTAX_ORDER[i];
  return "plain";
}

function docOf(lines: string[]): DocLike {
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const line = (n: number): DocLine => ({ from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length, number: n, text: lines[n - 1] });
  return {
    length: Math.max(0, at - 1),
    lines: lines.length,
    line,
    lineAt(pos: number) {
      let n = 1;
      while (n < lines.length && starts[n] <= pos) n++;
      return line(n);
    },
  };
}

const toneOf = (state: State, prefix: string) => (state === "TODO" && prefix === "todo" ? "" : `${prefix}-${state.toLowerCase()}`);

/** The paint of every line of `text`. */
export function paintNote(text: string): LinePaint[] {
  const lines = text.split("\n");
  const doc = docOf(lines);
  const tree = noteParser.parse(text);

  // Every character's classes, from the syntax tree.
  const roles: (Set<PaintRole> | undefined)[] = new Array(text.length);
  highlightTree(tree, highlighter, (from, to, classes) => {
    const set = new Set(classes.split(" ") as PaintRole[]);
    for (let i = from; i < to; i++) roles[i] = set;
  });

  // Bare urls: the ones in the text that no link or url node already holds
  // (links.ts, the editor's own pass).
  const bare = new Uint8Array(text.length);
  const held: [number, number][] = [];
  tree.iterate({
    enter(n) {
      if (LINK_NODES.has(n.name)) {
        if (n.node.getChild("URL")) held.push([n.from, n.to]);
        return false;
      }
      if (n.name === "URL") held.push([n.from, n.to]);
      return true;
    },
  });
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    for (const r of scanUrls(line.text)) {
      const a = line.from + r.from;
      const z = line.from + r.to;
      if (held.some(([f, e]) => f <= a && z <= e)) continue;
      if (!externalUrl(text.slice(a, z))) continue;
      for (let i = a; i < z; i++) bare[i] = 1;
    }
  }

  const owners = ownersForRange(doc, 1, doc.lines);
  const out: LinePaint[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const tagMatch = LINE_TAG.exec(line.text);
    const owner = owners[n - 1];
    const tone = tagMatch ? toneOf(norm(tagMatch[2]), "todo") : owner ? toneOf(owner, "child") : "";
    const tag: [number, number] | null = tagMatch ? [tagMatch[1].length, tagMatch[0].length] : null;
    const onTodo = tone !== "";
    const runs: PaintRun[] = [];
    for (let i = 0; i < line.text.length; i++) {
      if (tag && i >= tag[0] && i < tag[1]) continue;
      const at = line.from + i;
      const role = resolve(roles[at] ?? new Set(), bare[at] === 1, onTodo);
      const last = runs[runs.length - 1];
      if (last && last.role === role && last.to === i) last.to = i + 1;
      else runs.push({ from: i, to: i + 1, role });
    }
    out.push({ tone, tag, runs });
  }
  return out;
}
