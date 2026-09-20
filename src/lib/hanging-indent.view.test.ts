// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@uiw/react-codemirror";
import { afterEach, describe, expect, it } from "vitest";
import { hangingIndent } from "./hanging-indent.ts";
import { todoHighlighter } from "./todo.ts";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

const lineStyles = (doc: string) => {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [hangingIndent, todoHighlighter, EditorView.lineWrapping] }),
    parent: document.body,
  });
  return Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-line")).map((el) => el.getAttribute("style") ?? "");
};

describe("hangingIndent on a real view", () => {
  it("styles the lines with a prefix and leaves the rest alone", () => {
    const styles = lineStyles("# Title\n\n- item\n  - nested\nplain\n/TODO task\n");
    expect(styles[0]).toBe("");
    expect(styles[1]).toBe("");
    // The browser normalises the calc; the numbers are what matter.
    expect(styles[2]).toMatch(/padding-left: calc\((2ch \+ 6px|6px \+ 2ch)\)/);
    expect(styles[3]).toMatch(/padding-left: calc\((4ch \+ 6px|6px \+ 4ch)\)/);
    expect(styles[4]).toBe("");
    // `/TODO task`: the box is one column and the space after it another —
    // the same two columns `- ` takes, so the two kinds of item hang alike.
    expect(styles[5]).toMatch(/padding-left: calc\((2ch \+ 6px|6px \+ 2ch)\)/);
  });

  it("follows an edit that adds or removes the marker", () => {
    lineStyles("item");
    const v = view!;
    expect(v.dom.querySelector(".cm-line")!.getAttribute("style")).toBeNull();
    v.dispatch({ changes: { from: 0, insert: "- " } });
    expect(v.dom.querySelector(".cm-line")!.getAttribute("style")).toContain("2ch");
    v.dispatch({ changes: { from: 0, to: 2, insert: "" } });
    expect(v.dom.querySelector(".cm-line")!.getAttribute("style")).toBeNull();
  });
});
