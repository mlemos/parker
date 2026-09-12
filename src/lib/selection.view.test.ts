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
