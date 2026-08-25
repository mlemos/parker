// Text arriving from outside the editor — a reload from disk, or the same note
// being typed into in another pane — and the marks it leaves behind.
//
// Two pieces that belong together:
//
// `External` annotates those transactions so the pane does not report them back
// as edits. Without it a reload is indistinguishable from typing: the buffer
// goes dirty, autosave writes the file it just read, and the marks below are
// wiped by the very change that created them. (@uiw/react-codemirror carried
// this guard; hand-rolling the view is what dropped it.)
//
// `changedLines` decorates the lines a reload rewrote. They stay until the
// first keystroke in the note — a mark you can read at leisure, not a flash
// that fires whether or not anyone is watching.
import {
  Annotation,
  Decoration,
  EditorView,
  GutterMarker,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  gutterLineClass,
} from "@uiw/react-codemirror";
import type { DecorationSet } from "@uiw/react-codemirror";

/** Marks a transaction as "not the user's typing". */
export const External = Annotation.define<boolean>();

/** Replace the set of marked lines (1-based). An empty array clears them. */
export const setChangedLines = StateEffect.define<number[]>();

const changedLine = Decoration.line({ class: "cm-line-changed" });

export const changedLinesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    // Marks follow their text: editing above a marked line must not leave the
    // mark behind on the wrong one.
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setChangedLines)) continue;
      const b = new RangeSetBuilder<Decoration>();
      for (const n of e.value) {
        if (n < 1 || n > tr.state.doc.lines) continue;
        b.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, changedLine);
      }
      deco = b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * The same lines, marked in the gutters.
 *
 * A background on the line alone stops where the text does, leaving the line
 * number outside the band — the mark looked like it belonged to the text rather
 * than to the line. This is how CodeMirror highlights the active line too: a
 * decoration for the content, a gutter class for the margin. `gutterLineClass`
 * reaches every gutter, so the fold chevron's column is covered as well and the
 * band has no gap in it.
 */
const changedGutter = new (class extends GutterMarker {
  elementClass = "cm-changed-gutter";
})();

const changedGutterField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setChangedLines)) continue;
      const b = new RangeSetBuilder<GutterMarker>();
      for (const n of e.value) {
        if (n < 1 || n > tr.state.doc.lines) continue;
        const at = tr.state.doc.line(n).from;
        b.add(at, at, changedGutter);
      }
      marks = b.finish();
    }
    return marks;
  },
  provide: (f) => gutterLineClass.from(f),
});

export const changedLines = [changedLinesField, changedGutterField];
