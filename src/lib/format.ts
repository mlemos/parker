// Inline formatting from the keyboard. ⌘B, ⌘I, ⌘E and ⌘⇧X put markdown's
// marks around the selection — or the word under the caret — and take them
// off again when they are already there; ⌘K makes a link. Pure state
// commands: they read the document and describe a change, and never touch
// the DOM, so format.test.ts drives them with nothing but an EditorState.
//
// The marks share characters — `*` is italic, `**` bold, `***` both — so a
// mark is recognised by the length of the run on each side, not by a string
// match: toggling italic on **bold** wraps a third star round it rather than
// peeling one off and leaving *bold* behind.
import { EditorSelection, Prec, keymap } from "@uiw/react-codemirror";
import type { EditorState, StateCommand } from "@uiw/react-codemirror";
import { externalUrl } from "./open";

interface Mark {
  /** What goes on each side. */
  text: string;
  /** Whether a run of `n` of the mark's character, on one side, is this mark. */
  is: (n: number) => boolean;
}

const BOLD: Mark = { text: "**", is: (n) => n >= 2 };
// One star is italic and three are bold-italic; two are bold alone.
const ITALIC: Mark = { text: "*", is: (n) => n >= 1 && n !== 2 };
const CODE: Mark = { text: "`", is: (n) => n >= 1 };
const STRIKE: Mark = { text: "~~", is: (n) => n >= 2 };

/** How many `ch` in a row end at `pos` (dir -1) or start at `pos` (dir 1).
 *  A newline is never `ch`, so a run stops at the line. */
function run(state: EditorState, pos: number, ch: string, dir: -1 | 1): number {
  const doc = state.doc;
  let n = 0;
  for (;;) {
    const p = dir < 0 ? pos - n - 1 : pos + n;
    if (p < 0 || p >= doc.length || doc.sliceString(p, p + 1) !== ch) return n;
    n++;
  }
}

/** The mark sits just outside [from, to]. */
function around(state: EditorState, from: number, to: number, m: Mark): boolean {
  const ch = m.text[0];
  return m.is(run(state, from, ch, -1)) && m.is(run(state, to, ch, 1));
}

/** [from, to] starts and ends with the mark, with room for both. */
function inside(state: EditorState, from: number, to: number, m: Mark): boolean {
  const ch = m.text[0];
  if (to - from < m.text.length * 2) return false;
  const lead = Math.min(run(state, from, ch, 1), to - from);
  const tail = Math.min(run(state, to, ch, -1), to - from);
  return m.is(lead) && m.is(tail);
}

function toggle(m: Mark): StateCommand {
  return ({ state, dispatch }) => {
    const len = m.text.length;
    const tr = state.changeByRange((range) => {
      let { from, to } = range;
      // A bare caret formats the word it is in, and lands back in the same
      // place in it; a selection stays a selection, of the same text.
      const caret = range.empty ? range.head : -1;
      if (range.empty && !around(state, from, to, m)) {
        const word = state.wordAt(from);
        if (word) ({ from, to } = word);
      }
      if (around(state, from, to, m)) {
        return {
          changes: [
            { from: from - len, to: from },
            { from: to, to: to + len },
          ],
          range:
            caret >= 0
              ? EditorSelection.cursor(caret - len)
              : EditorSelection.range(from - len, to - len),
        };
      }
      if (inside(state, from, to, m)) {
        return {
          changes: [
            { from, to: from + len },
            { from: to - len, to },
          ],
          range:
            caret >= 0
              ? EditorSelection.cursor(Math.min(Math.max(caret - len, from), to - 2 * len))
              : EditorSelection.range(from, to - 2 * len),
        };
      }
      if (from === to) {
        // Nothing to wrap: open the mark and leave the caret inside it.
        return {
          changes: { from, insert: m.text + m.text },
          range: EditorSelection.cursor(from + len),
        };
      }
      return {
        changes: [
          { from, insert: m.text },
          { from: to, insert: m.text },
        ],
        range:
          caret >= 0
            ? EditorSelection.cursor(caret + len)
            : EditorSelection.range(from + len, to + len),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export const toggleBold = toggle(BOLD);
export const toggleItalic = toggle(ITALIC);
export const toggleCode = toggle(CODE);
export const toggleStrike = toggle(STRIKE);

const WHOLE_LINK = /^\[([^\]]*)\]\([^)]*\)$/;

/**
 * ⌘K. Selected text becomes a link's text, with a placeholder address
 * selected so the real one can be typed or pasted straight over it. A
 * selected address becomes the link's target, with the caret in the brackets
 * waiting for the text. A link selected whole is undone: its text stays, the
 * address goes.
 */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    let { from, to } = range;
    if (range.empty) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const text = state.sliceDoc(from, to);
    const whole = WHOLE_LINK.exec(text);
    if (whole) {
      return {
        changes: { from, to, insert: whole[1] },
        range: EditorSelection.range(from, from + whole[1].length),
      };
    }
    if (text && externalUrl(text)) {
      return {
        changes: { from, to, insert: `[](${text})` },
        range: EditorSelection.cursor(from + 1),
      };
    }
    const url = from + text.length + 3;
    return {
      changes: { from, to, insert: `[${text}](url)` },
      range: EditorSelection.range(url, url + 3),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/** ⌘K is the help window's no longer; it belongs to links, as everywhere else. */
export const formatKeymap = Prec.high(
  keymap.of([
    { key: "Mod-b", run: toggleBold },
    { key: "Mod-i", run: toggleItalic },
    { key: "Mod-e", run: toggleCode },
    { key: "Shift-Mod-x", run: toggleStrike },
    { key: "Mod-k", run: insertLink },
  ])
);
