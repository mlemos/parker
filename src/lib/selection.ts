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
import { EditorSelection } from "@codemirror/state";
import { EditorView, Prec, RectangleMarker, drawSelection, layer } from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";

const drawn = new Compartment();

const multi = (state: EditorState) => state.selection.ranges.length > 1;

// ---- The caret -------------------------------------------------------------
//
// WKWebView's own caret can leave a copy of itself behind: a caret that moves
// at the wrong moment of its blink is drawn at the new place and never erased
// from the old one — ⌘⏎, ⌫, Tab on an empty line, and a frozen caret stays at
// column 0 while the real one blinks at column 2. Repainting the lines did not
// clear it; it is WebKit's caret animation, not the page's paint.
//
// So the caret is CodeMirror's, always, and the browser's is transparent. The
// selection stays the browser's while there is one range (above): this layer
// draws only the caret, and only then — with two or more ranges drawSelection
// draws the carets along with the ranges. It takes CodeMirror's cursor-layer
// class, which brings the theme's caret colour, the blink, and hiding it when
// the editor is not focused; the blink restarts on every move, as a native
// caret's does.
const caretLayer = layer({
  above: true,
  class: "cm-cursorLayer",
  markers(view) {
    const { ranges, main } = view.state.selection;
    if (ranges.length > 1 || !main.empty) return [];
    return RectangleMarker.forRange(view, "cm-cursor cm-cursor-primary", EditorSelection.cursor(main.head, main.assoc));
  },
  update(update, dom) {
    if (update.transactions.some((tr) => tr.selection))
      dom.style.animationName = dom.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink";
    return update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged;
  },
  mount(dom) {
    dom.style.animationDuration = "1200ms";
  },
});

const hideNativeCaret = Prec.highest(
  EditorView.theme({
    ".cm-content, .cm-line": { caretColor: "transparent !important" },
  })
);

export const hybridSelection: Extension = [
  caretLayer,
  hideNativeCaret,
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
