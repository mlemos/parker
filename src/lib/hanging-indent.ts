// Wrapped lines hang under their text, not under their marker.
//
// A long list item or to-do that wraps used to continue at column 0, so a
// two-line item read as an item followed by a stray paragraph. Now the
// continuation starts where the item's text does: after the indentation and
// the marker, which is where the eye already is.
//
// Done with CSS, per line: padding-left the width of the prefix and a
// text-indent of minus the same, so the first row starts at the margin and
// every row after it starts at the text. The editor is monospace, so the
// prefix is measured in `ch` and needs no DOM measurement — the to-do box
// included: the widget is laid out one column wide, like the list marker it
// stands in the place of (App.css .cm-todo-box).

import { Decoration, EditorView, ViewPlugin } from "@uiw/react-codemirror";
import type { DecorationSet, ViewUpdate } from "@uiw/react-codemirror";
import { RangeSetBuilder } from "@uiw/react-codemirror";
import { LINE_TAG } from "./todo-model";

/** Base left padding CodeMirror gives every .cm-line. */
const LINE_PAD = "6px";
/** The to-do box widget's width: one column, like a list marker (App.css .cm-todo-box). */
const BOX = "1ch";

/** The leading part of a line the continuation should hang under: the
 *  indentation, then a list marker (`- `, `* `, `+ `, `1. `, `1) `), a quote
 *  marker (`> `), or a to-do tag with its space. Returns the prefix as text columns plus
 *  whether a to-do box stands in for the tag — null when the line has no
 *  prefix to hang under (a plain paragraph, a heading). */
export function hangingPrefix(text: string): { cols: number; box: boolean } | null {
  const ws = /^[ \t]*/.exec(text)![0].length;
  const rest = text.slice(ws);
  if (rest.length === 0) return null;

  const tag = LINE_TAG.exec(text);
  if (tag) {
    // The tag is drawn as the box; the space after it is still text.
    const after = text.slice(tag[0].length);
    const gap = /^[ \t]*/.exec(after)![0].length;
    return { cols: ws + gap, box: true };
  }

  const marker = /^(?:[-*+]|\d{1,3}[.)]|>)[ \t]+/.exec(rest);
  if (marker) return { cols: ws + marker[0].length, box: false };

  // Indented text with no marker still hangs under its own start — a
  // continuation paragraph inside a list, or a nested line under a to-do.
  if (ws > 0) return { cols: ws, box: false };
  return null;
}

/** The CSS for a prefix: padding and negative indent of the same width. */
export function hangingStyle(p: { cols: number; box: boolean }): string {
  const w = p.box ? `calc(${p.cols}ch + ${BOX})` : `${p.cols}ch`;
  return `padding-left: calc(${LINE_PAD} + ${w}); text-indent: calc(-1 * (${w}));`;
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const cache = new Map<string, Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const p = hangingPrefix(line.text);
      if (p) {
        const style = hangingStyle(p);
        let deco = cache.get(style);
        if (!deco) {
          deco = Decoration.line({ attributes: { style } });
          cache.set(style, deco);
        }
        b.add(line.from, line.from, deco);
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

class HangingIndent {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = build(view);
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
  }
}

/** The extension. Harmless without line wrapping: a line that does not wrap
 *  has no continuation to hang. */
export const hangingIndent = ViewPlugin.fromClass(HangingIndent, {
  decorations: (v) => v.decorations,
});
