// Folding.
//
// Most of this is CodeMirror's, switched on rather than written: the markdown
// language already folds a heading into its section (down to the next heading
// of the same or higher level) and collapses fenced code, quotes and tables,
// and every other language package brings its own rules.
//
// What it does not fold is the shape Parker's notes actually take. lang-markdown
// deliberately skips lists, and a Parker to-do is not a list item at all — it is
// a plain line with more-indented lines under it. So one fold service is ours:
// a line swallows whatever is indented beneath it. That single rule covers
// nested to-dos, markdown lists, and outlines in files with no language at all.
//
// Chevrons in the gutter mark what can be folded, the way an editor is expected
// to: they sit with the line numbers and appear on hover, so an untouched note
// stays as bare as the rest of the app, while a folded one keeps its chevron
// visible — a fold should never be able to hide silently. ⌘⌥[ / ⌘⌥] do the same
// job from the keyboard, and the badge left in place of the hidden lines counts
// them and unfolds when clicked.
import {
  codeFolding,
  foldEffect,
  foldGutter,
  foldKeymap,
  foldService,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
// Via the app's editor package rather than @codemirror/view directly: that one
// is a transitive dependency, and pnpm keeps those out of reach on purpose.
import {
  GutterMarker,
  RangeSetBuilder,
  StateField,
  countColumn,
  keymap,
  lineNumberMarkers,
} from "@uiw/react-codemirror";
import type { EditorState, Extension, RangeSet } from "@uiw/react-codemirror";

/** Width of a line's leading whitespace, counting a tab as a tab. */
function indentOf(text: string, tabSize: number): number {
  const ws = /^\s*/.exec(text)![0];
  return countColumn(ws, tabSize);
}

const blank = (text: string) => !text.trim();

/**
 * Fold a line's more-indented children.
 *
 * Blank lines don't end a block — a to-do list with air between its items is
 * still one block — but they don't extend it either: the fold stops at the last
 * line with content, so folding never swallows the gap before whatever comes
 * next.
 *
 * Headings return null on purpose. The markdown service folds a heading into
 * its whole section, which is the better answer, and `foldable()` takes the
 * first service that responds — so this one has to stand aside rather than
 * race it.
 */
export const indentFold = foldService.of((state: EditorState, from: number, to: number) => {
  const line = state.doc.lineAt(from);
  if (blank(line.text)) return null;
  if (/^\s*#{1,6}\s/.test(line.text)) return null;

  const parent = indentOf(line.text, state.tabSize);
  let end = -1;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n);
    if (blank(next.text)) continue;
    if (indentOf(next.text, state.tabSize) <= parent) break;
    end = next.to;
  }
  return end < 0 ? null : { from: to, to: end };
});

/** Lucide `chevron-down` and `chevron-right`, drawn the way every other glyph in
    the app is: stroked, round caps, one stroke width. */
function chevron(open: boolean): HTMLElement {
  const NS = "http://www.w3.org/2000/svg";
  const el = document.createElement("span");
  el.className = "cm-fold-marker" + (open ? " open" : " closed");
  el.title = open ? "Fold (⌘⌥[)" : "Unfold (⌘⌥])";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6");
  svg.appendChild(path);
  el.appendChild(svg);
  return el;
}

/**
 * The line number of a folded line takes the chevron's colour.
 *
 * The closed chevron already says "something is hidden here"; colouring the
 * number too makes that readable from across the gutter, when you are scanning
 * a long note for where you left things closed rather than looking at one line.
 */
const foldedNumber = new (class extends GutterMarker {
  elementClass = "cm-folded-number";
})();

function foldedNumbers(state: EditorState): RangeSet<GutterMarker> {
  const b = new RangeSetBuilder<GutterMarker>();
  const iter = foldedRanges(state).iter();
  let lastLine = -1;
  while (iter.value) {
    const line = state.doc.lineAt(iter.from);
    // Two folds can start on the same line; the number is marked once.
    if (line.number !== lastLine) {
      b.add(line.from, line.from, foldedNumber);
      lastLine = line.number;
    }
    iter.next();
  }
  return b.finish();
}

const foldedNumberField = StateField.define<RangeSet<GutterMarker>>({
  create: foldedNumbers,
  update(value, tr) {
    // Only when the set of folds could have moved. Every keystroke would
    // otherwise pay for a walk over the fold ranges.
    const foldsChanged = tr.effects.some(
      (e) => e.is(foldEffect) || e.is(unfoldEffect)
    );
    return tr.docChanged || foldsChanged ? foldedNumbers(tr.state) : value;
  },
  provide: (f) => lineNumberMarkers.from(f),
});

/** The chevron column. Kept separate because it rides with the line-number
    gutter: one gutter switch, ⌘⇧L, turns both on and off together. */
export const foldMarkers: Extension = [
  foldGutter({ markerDOM: chevron }),
  foldedNumberField,
];

/** Everything folding needs, minus the gutter. */
export const folding: Extension = [
  codeFolding({
    preparePlaceholder: (state, range) => ({
      lines:
        state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
    }),
    // A badge, in the same language as the git chip's pending count: the number
    // alone, tinted with the accent. It says how much is hidden without turning
    // into a phrase sitting in the middle of a sentence.
    placeholderDOM: (_view, onclick, prepared) => {
      const el = document.createElement("span");
      el.className = "cm-foldPlaceholder";
      const n = (prepared as { lines: number } | null)?.lines ?? 0;
      el.textContent = n > 0 ? String(n) : "…";
      el.title = n > 0 ? `${n} ${n === 1 ? "line" : "lines"} folded` : "Folded";
      el.setAttribute("aria-label", el.title);
      el.onclick = onclick;
      return el;
    },
  }),
  indentFold,
  keymap.of(foldKeymap),
];
