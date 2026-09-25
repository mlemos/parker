// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, getDefaultExtensions } from "@uiw/react-codemirror";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todoKeymap } from "./todo.ts";

// CodeMirror decides what "Mod" means from navigator.platform when it loads;
// jsdom reports none, which would make Mod = Ctrl. These are Mac chords.
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});

// The keymap, exercised the way a keyboard does: real keydown events on a real
// view, with CodeMirror's default keymap underneath — so a chord that is ours
// runs ours, and a chord that was already CodeMirror's still reaches
// CodeMirror. ⌥⌘↑ was "add cursor above" before #35 took it by mistake; this
// is what keeps that from happening again.

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function open(doc: string, head: number) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(head),
      extensions: [
        getDefaultExtensions({ basicSetup: { syntaxHighlighting: false } }),
        todoKeymap,
      ],
    }),
    parent: document.body,
  });
  return view;
}

/** A keydown as the browser would deliver it for a Mac chord. */
function press(v: EditorView, key: string, mods: Partial<KeyboardEventInit> = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  v.contentDOM.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("to-do keys on a real view", () => {
  it("⌃⌘↑ / ⌃⌘↓ step the priority of the task under the cursor", () => {
    const v = open("/TODO ship it", 8);
    expect(press(v, "ArrowUp", { ctrlKey: true, metaKey: true })).toBe(true);
    expect(v.state.doc.toString()).toBe("/TODO! ship it");
    press(v, "ArrowUp", { ctrlKey: true, metaKey: true });
    press(v, "ArrowUp", { ctrlKey: true, metaKey: true });
    press(v, "ArrowUp", { ctrlKey: true, metaKey: true }); // clamped
    expect(v.state.doc.toString()).toBe("/TODO!!! ship it");
    press(v, "ArrowDown", { ctrlKey: true, metaKey: true });
    expect(v.state.doc.toString()).toBe("/TODO!! ship it");
  });

  it("⌃⌘↑ leaves plain text alone and lets the key fall through", () => {
    const v = open("just text", 4);
    press(v, "ArrowUp", { ctrlKey: true, metaKey: true });
    expect(v.state.doc.toString()).toBe("just text");
  });

  it("⌥⌘↑ on a task is not priority any more", () => {
    // CodeMirror's add-cursor-above needs layout to find the line above, which
    // jsdom cannot give it — so what this can prove is only the half that
    // matters here: the chord no longer touches the tag.
    const v = open("first\n/TODO second", 12);
    press(v, "ArrowUp", { altKey: true, metaKey: true });
    expect(v.state.doc.toString()).toBe("first\n/TODO second");
  });

  it("⏎ continues a task and ⇧⏎ does not", () => {
    const v = open("/TODO one", 9);
    press(v, "Enter");
    expect(v.state.doc.toString()).toBe("/TODO one\n/TODO ");
    press(v, "Enter", { shiftKey: true });
    expect(v.state.doc.toString()).toBe("/TODO one\n/TODO \n");
  });

  it("⌘⏎ rotates and keeps the bangs", () => {
    const v = open("/TODO!! one", 3);
    press(v, "Enter", { metaKey: true });
    expect(v.state.doc.toString()).toBe("/DOING!! one");
  });
});

// The two cases in parker-cursor-bug.md, as the keyboard does them: ⌘⏎ on an
// empty line leaves "/TODO |", and then…
describe("right after ⌘⏎ makes a task", () => {
  /** Type as the DOM input path does: through the editor's input handlers,
   *  which is where "!" is taken over. */
  function type(v: EditorView, text: string) {
    const { from, to } = v.state.selection.main;
    const handled = v.state
      .facet(EditorView.inputHandler)
      .some((h) => h(v, from, to, text, () => v.state.update({ changes: { from, to, insert: text } })));
    if (!handled) v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
  }
  const shown = (v: EditorView) => {
    const s = v.state.doc.toString();
    const h = v.state.selection.main.head;
    return s.slice(0, h) + "|" + s.slice(h);
  };

  it("⌫ takes the checkbox away (Bug 1)", () => {
    const v = open("", 0);
    press(v, "Enter", { metaKey: true });
    expect(shown(v)).toBe("/TODO |");
    press(v, "Backspace");
    expect(shown(v)).toBe("|");
  });

  it("⌫ at the start of a task's text leaves the text, not /TODObuy", () => {
    const v = open("/TODO buy milk", 6);
    press(v, "Backspace");
    expect(shown(v)).toBe("|buy milk");
  });

  it("! raises the priority and the cursor stays put (Bug 2)", () => {
    const v = open("", 0);
    press(v, "Enter", { metaKey: true });
    type(v, "!");
    expect(shown(v)).toBe("/TODO! |");
    type(v, "!");
    type(v, "!");
    expect(shown(v)).toBe("/TODO!!! |");
    type(v, "!"); // a fourth is text
    expect(shown(v)).toBe("/TODO!!! !|");
  });

  it("a list item does the same: Enter, then ⌫, is an empty line", () => {
    const v = open("- a", 3);
    press(v, "Enter");
    expect(shown(v)).toBe("- a\n- |");
    press(v, "Backspace");
    expect(shown(v)).toBe("- a\n|");
  });

  it("⌫ at the start of a nested item's text keeps its indentation", () => {
    const v = open("- a\n  - b", 8);
    press(v, "Backspace");
    expect(shown(v)).toBe("- a\n  |b");
  });

  it("! in the middle of the text is text", () => {
    const v = open("/TODO buy milk", 10);
    type(v, "!");
    expect(shown(v)).toBe("/TODO buy !|milk");
  });
});
