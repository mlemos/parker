// Who draws the selection: the browser, or CodeMirror.
//
// Since v0.4.4 the browser draws it. The native selection hugs the text and
// adds a small tail for the line break — the shape VS Code has — where
// CodeMirror's fills the middle lines to the full width of the content. The
// cost was that a native selection can only show ONE range, so ⌘D's extra
// matches were edited but never seen.
//
// This keeps both: the browser draws while there is a single range, and
// CodeMirror's drawSelection takes over the moment there are two or more,
// because it is the only one of the two that can show them. The switch is a
// Compartment reconfigured from a transactionExtender, so it happens inside the
// same transaction that changes the number of ranges — no listener, no second
// dispatch, no frame where ⌘D's second match exists but is invisible.
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection } from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";

const drawn = new Compartment();

const multi = (state: EditorState) => state.selection.ranges.length > 1;

export const hybridSelection: Extension = [
  drawn.of([]),
  EditorState.transactionExtender.of((tr) => {
    // Without allowMultipleSelections the state keeps only the main range,
    // whatever the transaction asked for — so there is never anything for
    // CodeMirror to draw that the browser could not.
    const allowed = tr.startState.facet(EditorState.allowMultipleSelections);
    const after = allowed && tr.newSelection.ranges.length > 1;
    if (after === multi(tr.startState)) return null;
    return { effects: drawn.reconfigure(after ? drawSelection() : []) };
  }),
];

/** Whether CodeMirror (rather than the browser) is drawing the selection. */
export const selectionIsDrawn = (state: EditorState): boolean => {
  const ext = drawn.get(state);
  return Array.isArray(ext) ? ext.length > 0 : ext !== undefined;
};
