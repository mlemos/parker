// Line numbers of the lines a selection covers.
//
// CodeMirror already brightens the gutter of the line the cursor sits on
// (highlightActiveLineGutter) and paints the selection over the selected text
// — not the whole line, which is the behaviour we want and the one VS Code has.
// What it does not do is tell the margin about a selection that spans lines: you
// drag over six lines and the numbers beside them stay as quiet as the rest.
//
// This adds only that. Same mechanism CodeMirror uses for the active line —
// gutterLineClass recomputed from the selection — so a selection and the active
// line agree about the margin instead of fighting over it.
import { GutterMarker, RangeSet, gutterLineClass } from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";

const selectedLine = new (class extends GutterMarker {
  elementClass = "cm-selectedLineGutter";
})();

export const selectionGutter: Extension = gutterLineClass.compute(
  ["selection"],
  (state) => {
    const marks = [];
    for (const range of state.selection.ranges) {
      // An empty range is a caret, and the active-line highlight owns that.
      if (range.empty) continue;
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        marks.push(selectedLine.range(state.doc.line(n).from));
      }
    }
    // Sorted by construction: ranges come in document order, lines ascend.
    return RangeSet.of(marks, true);
  }
);
