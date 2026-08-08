// Lightweight to-do highlighting: mark the keywords TODO / DONE / FAIL anywhere
// they appear (also matches the /TODO /DONE /FAIL slash forms). It's a plain
// decoration pass over the visible range — no language, no parser — so it works
// in every file type and layers on top of the syntax theme.
import { Decoration, ViewPlugin, RangeSetBuilder } from "@uiw/react-codemirror";
import type {
  DecorationSet,
  EditorView,
  ViewUpdate,
} from "@uiw/react-codemirror";

const KEYWORD = /(?:^|[\s/([{"'])(TODO|DONE|FAIL)\b/g;

const MARKS: Record<string, Decoration> = {
  TODO: Decoration.mark({ class: "cm-todo cm-todo-todo" }),
  DONE: Decoration.mark({ class: "cm-todo cm-todo-done" }),
  FAIL: Decoration.mark({ class: "cm-todo cm-todo-fail" }),
};

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let m: RegExpExecArray | null;
    KEYWORD.lastIndex = 0;
    while ((m = KEYWORD.exec(text))) {
      const word = m[1];
      // m.index points at the leading delimiter (or start); offset to the word.
      const start = from + m.index + (m[0].length - word.length);
      builder.add(start, start + word.length, MARKS[word]);
    }
  }
  return builder.finish();
}

export const todoHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);
