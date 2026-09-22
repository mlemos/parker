import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { StateCommand } from "@codemirror/state";
import { insertLink, toggleBold, toggleCode, toggleItalic, toggleStrike } from "./format.ts";

// A document with its selection drawn in: `|` is the caret, «…» a selection.
function parse(src: string) {
  const a = src.indexOf("«");
  if (a >= 0) {
    const doc = src.replace("«", "").replace("»", "");
    return { doc, anchor: a, head: src.indexOf("»") - 1 };
  }
  const c = src.indexOf("|");
  return { doc: src.replace("|", ""), anchor: c, head: c };
}

function show(state: EditorState): string {
  const { from, to } = state.selection.main;
  const d = state.doc.toString();
  return from === to
    ? d.slice(0, from) + "|" + d.slice(from)
    : d.slice(0, from) + "«" + d.slice(from, to) + "»" + d.slice(to);
}

function apply(cmd: StateCommand, src: string): string {
  const p = parse(src);
  let state = EditorState.create({
    doc: p.doc,
    selection: EditorSelection.single(p.anchor, p.head),
  });
  cmd({ state, dispatch: (tr) => (state = tr.state) });
  return show(state);
}

describe("bold", () => {
  it("wraps a selection and keeps it selected", () => {
    expect(apply(toggleBold, "say «hello» now")).toBe("say **«hello»** now");
  });
  it("takes the marks off a selection that has them outside", () => {
    expect(apply(toggleBold, "say **«hello»** now")).toBe("say «hello» now");
  });
  it("takes the marks off a selection that has them inside", () => {
    expect(apply(toggleBold, "say «**hello**» now")).toBe("say «hello» now");
  });
  it("formats the word under the caret and keeps the caret in it", () => {
    expect(apply(toggleBold, "say hel|lo now")).toBe("say **hel|lo** now");
    expect(apply(toggleBold, "say hello| now")).toBe("say **hello|** now");
  });
  it("undoes it from the caret too", () => {
    expect(apply(toggleBold, "say **hel|lo** now")).toBe("say hel|lo now");
  });
  it("opens a mark for the caret to type into when there is no word", () => {
    expect(apply(toggleBold, "say |")).toBe("say **|**");
  });
  it("closes an empty mark again", () => {
    expect(apply(toggleBold, "say **|**")).toBe("say |");
  });
  it("wraps every range of a multiple selection", () => {
    let state = EditorState.create({
      doc: "aa bb",
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)]),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    toggleBold({ state, dispatch: (tr) => (state = tr.state) });
    expect(state.doc.toString()).toBe("**aa** **bb**");
    // Each caret is still where it was in its word.
    expect(state.selection.ranges.map((r) => r.head)).toEqual([3, 10]);
  });
});

describe("italic against bold", () => {
  it("adds a third star round bold rather than stealing one", () => {
    expect(apply(toggleItalic, "**«bold»**")).toBe("***«bold»***");
    expect(apply(toggleItalic, "«**bold**»")).toBe("*«**bold**»*");
  });
  it("takes its one star back off bold-italic", () => {
    expect(apply(toggleItalic, "***«x»***")).toBe("**«x»**");
    expect(apply(toggleBold, "***«x»***")).toBe("*«x»*");
  });
  it("wraps and unwraps plainly", () => {
    expect(apply(toggleItalic, "«x»")).toBe("*«x»*");
    expect(apply(toggleItalic, "*«x»*")).toBe("«x»");
  });
});

describe("code and strikethrough", () => {
  it("use their own marks", () => {
    expect(apply(toggleCode, "«x»")).toBe("`«x»`");
    expect(apply(toggleCode, "`«x»`")).toBe("«x»");
    expect(apply(toggleStrike, "«x»")).toBe("~~«x»~~");
    expect(apply(toggleStrike, "~~«x»~~")).toBe("«x»");
  });
});

describe("link", () => {
  it("makes the selection the text and offers the address to type over", () => {
    expect(apply(insertLink, "see «Parker» now")).toBe("see [Parker](«url») now");
  });
  it("makes a selected address the target and waits for the text", () => {
    expect(apply(insertLink, "«https://getparker.dev»")).toBe("[|](https://getparker.dev)");
  });
  it("takes the word under the caret", () => {
    expect(apply(insertLink, "see Par|ker now")).toBe("see [Parker](«url») now");
  });
  it("starts an empty link when there is nothing to take", () => {
    expect(apply(insertLink, "see |")).toBe("see [](«url»)");
  });
  it("undoes a link selected whole", () => {
    expect(apply(insertLink, "«[Parker](https://getparker.dev)»")).toBe("«Parker»");
  });
});
