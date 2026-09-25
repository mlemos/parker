// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@uiw/react-codemirror";
import { afterEach, describe, expect, it } from "vitest";
import { hybridSelection } from "./selection.ts";

// The state tests prove the compartment flips; this proves the flip reaches
// the DOM through a real view's dispatch — the selection layer CodeMirror
// draws with exists exactly while there are two or more ranges.

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

const layer = () => view!.dom.querySelector(".cm-selectionLayer");

describe("hybrid selection in a view", () => {
  it("adds CodeMirror's selection layer for two ranges and removes it for one", () => {
    view = new EditorView({
      state: EditorState.create({
        doc: "one two one two",
        extensions: [
          hybridSelection,
          EditorState.allowMultipleSelections.of(true),
        ],
      }),
      parent: document.body,
    });
    expect(layer()).toBeNull();

    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(8, 11),
      ]),
    });
    expect(layer()).not.toBeNull();

    view.dispatch({ selection: EditorSelection.single(5) });
    expect(layer()).toBeNull();
  });
});

describe("the caret", () => {
  const make = (head: number, extra: EditorSelection["ranges"] = []) => {
    view = new EditorView({
      state: EditorState.create({
        doc: "one two one two",
        selection: EditorSelection.create([EditorSelection.cursor(head), ...extra]),
        extensions: [hybridSelection, EditorState.allowMultipleSelections.of(true)],
      }),
      parent: document.body,
    });
    return view;
  };
  const carets = () => view!.dom.querySelectorAll(".cm-cursor").length;

  // WKWebView leaves a copy of its own caret behind (see selection.ts).
  it("is CodeMirror's, and the browser's is made transparent", () => {
    make(3);
    expect(view!.dom.querySelector(".cm-cursorLayer")).not.toBeNull();
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("");
    expect(css).toMatch(/caret-color:\s*transparent !important/);
  });

  it("is not drawn over a selection, which the browser draws", () => {
    make(3);
    view!.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(carets()).toBe(0);
  });
});
