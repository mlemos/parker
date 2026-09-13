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
