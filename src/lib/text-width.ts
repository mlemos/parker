// The measure: how wide a line of text may run, in columns of the monospace
// font. 0 means the window's width.
//
// The CSS used to cap the content at a fixed 900px, left-aligned — a measure
// nobody chose and nobody could change. This is the same cap as a setting:
// a max-width on the content in `ch`, so it scales with the interface zoom
// (⌘= / ⌘-) the way the text does. The gutter stays on the window's left
// edge and the text stays against the gutter, as it always has: the measure
// only decides where a line stops, never where it starts.
import { EditorView } from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";

/** The choices Settings offers, in columns. 0 = window. */
export const TEXT_WIDTHS = [0, 80, 100, 120] as const;
export type TextWidth = (typeof TEXT_WIDTHS)[number];

/** A saved value, sanitized: anything that is not one of the choices is 0. */
export const textWidthOf = (n: number): TextWidth =>
  (TEXT_WIDTHS as readonly number[]).includes(n) ? (n as TextWidth) : 0;

/** The extension for one measure; goes in a Compartment like wrap. */
export const textWidth = (w: TextWidth): Extension =>
  w === 0
    ? []
    : EditorView.theme({
        // The line carries CodeMirror's own 6px + 2px of padding, so the
        // measure is the columns plus that — `ch` is the advance of "0",
        // which in a monospace face is every glyph.
        ".cm-content": { maxWidth: `calc(${w}ch + 8px)` },
      });
