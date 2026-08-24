import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { indentedFoldRange } from "./fold.ts";

// The rule Parker adds on top of CodeMirror's own folding: a line swallows
// whatever is indented beneath it. It is what makes nested to-dos and lists
// foldable, and it is pure text logic — exactly the kind that breaks silently
// under a later refactor.

/** Fold range for `line` (1-based), described as the lines it would hide. */
function foldedLines(doc: string, line: number): string[] | null {
  const state = EditorState.create({ doc });
  const l = state.doc.line(line);
  const range = indentedFoldRange(state, l.from, l.to);
  if (!range) return null;
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const out: string[] = [];
  // range.from is the end of the parent line, so the hidden lines start after it.
  for (let n = first + 1; n <= last; n++) out.push(state.doc.line(n).text);
  return out;
}

describe("indented folding", () => {
  it("hides the children of a to-do, and stops at its sibling", () => {
    const doc = [
      "/TODO parent",
      "  /DOING child one",
      "    detail",
      "  /DONE child two",
      "/TODO next parent",
    ].join("\n");
    expect(foldedLines(doc, 1)).toEqual([
      "  /DOING child one",
      "    detail",
      "  /DONE child two",
    ]);
  });

  it("folds a nested child on its own", () => {
    const doc = ["/TODO parent", "  /DOING child", "    detail", "  /DONE other"].join(
      "\n"
    );
    expect(foldedLines(doc, 2)).toEqual(["    detail"]);
  });

  it("leaves a line with nothing indented under it alone", () => {
    const doc = ["one", "two", "three"].join("\n");
    expect(foldedLines(doc, 1)).toBeNull();
  });

  it("treats a blank line as part of the block, not the end of it", () => {
    // A to-do list with air between its items is still one block.
    const doc = ["- parent", "  - one", "", "  - two", "next"].join("\n");
    expect(foldedLines(doc, 1)).toEqual(["  - one", "", "  - two"]);
  });

  it("does not let trailing blank lines extend the fold", () => {
    // Otherwise a fold would swallow the gap before whatever comes next.
    const doc = ["- parent", "  - only child", "", "", "unindented"].join("\n");
    expect(foldedLines(doc, 1)).toEqual(["  - only child"]);
  });

  it("stands aside on headings, which markdown folds into whole sections", () => {
    // foldable() takes the first service that answers, so returning a range
    // here would beat the better answer rather than defer to it.
    const doc = ["# Heading", "  indented under it", "more"].join("\n");
    expect(foldedLines(doc, 1)).toBeNull();
  });

  it("ignores a blank line as a fold source", () => {
    const doc = ["", "  indented", "back"].join("\n");
    expect(foldedLines(doc, 1)).toBeNull();
  });

  it("measures indentation in columns, so a tab equals its width", () => {
    const doc = ["parent", "\tchild by tab", "back"].join("\n");
    expect(foldedLines(doc, 1)).toEqual(["\tchild by tab"]);
  });

  it("folds to the end of the deepest run, not just the first child", () => {
    const doc = ["a", "  b", "    c", "      d", "e"].join("\n");
    expect(foldedLines(doc, 1)).toEqual(["  b", "    c", "      d"]);
  });

  it("has nothing to fold on the last line", () => {
    expect(foldedLines(["a", "  b"].join("\n"), 2)).toBeNull();
  });
});
