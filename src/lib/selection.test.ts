import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { hybridSelection, selectionIsDrawn } from "./selection.ts";

// The browser draws one range; CodeMirror draws two or more. The switch has to
// ride in the transaction that changes the count, in both directions.

const state = (multiple = true) =>
  EditorState.create({
    doc: "one two one two",
    extensions: [
      hybridSelection,
      EditorState.allowMultipleSelections.of(multiple),
    ],
  });

const two = EditorSelection.create([
  EditorSelection.range(0, 3),
  EditorSelection.range(8, 11),
]);

describe("hybrid selection", () => {
  it("starts with the browser drawing", () => {
    expect(selectionIsDrawn(state())).toBe(false);
  });

  it("hands over to CodeMirror when a second range appears", () => {
    expect(selectionIsDrawn(state().update({ selection: two }).state)).toBe(true);
  });

  it("hands back to the browser when the ranges collapse to one", () => {
    let s = state().update({ selection: two }).state;
    s = s.update({ selection: EditorSelection.single(5) }).state;
    expect(selectionIsDrawn(s)).toBe(false);
  });

  it("does not touch the configuration when the count does not change", () => {
    const a = state().update({ selection: EditorSelection.single(2) }).state;
    const tr = a.update({ selection: EditorSelection.single(4) });
    expect(tr.effects).toHaveLength(0);
  });

  it("leaves the browser in charge where multiple selections are not allowed", () => {
    // The state would keep only the main range anyway; drawing would be a
    // CodeMirror-shaped selection for no gain.
    expect(selectionIsDrawn(state(false).update({ selection: two }).state)).toBe(false);
  });
});
