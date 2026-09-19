import { describe, expect, it } from "vitest";
import { changedLines } from "./linediff.ts";

const doc = (...lines: string[]) => lines.join("\n");

describe("changedLines", () => {
  it("marks nothing when the text is identical", () => {
    expect(changedLines(doc("a", "b"), doc("a", "b"))).toEqual([]);
  });

  it("marks the one line that was rewritten", () => {
    expect(changedLines(doc("a", "b", "c"), doc("a", "B", "c"))).toEqual([2]);
  });

  it("marks a run of rewritten lines", () => {
    expect(changedLines(doc("a", "b", "c", "d"), doc("a", "B", "C", "d"))).toEqual([
      2, 3,
    ]);
  });

  it("marks lines that were inserted", () => {
    expect(changedLines(doc("a", "d"), doc("a", "b", "c", "d"))).toEqual([2, 3]);
  });

  it("marks an append at the end", () => {
    expect(changedLines(doc("a"), doc("a", "b"))).toEqual([2]);
  });

  it("marks an insertion at the very top", () => {
    expect(changedLines(doc("b"), doc("a", "b"))).toEqual([1]);
  });

  it("marks the junction when lines were only deleted", () => {
    // Nothing survives to highlight, so the mark goes where the text now reads
    // differently: the line the deletion left behind.
    expect(changedLines(doc("a", "b", "c"), doc("a", "c"))).toEqual([1]);
  });

  it("marks the first line when the whole file was replaced", () => {
    expect(changedLines(doc("a", "b"), doc("x", "y"))).toEqual([1, 2]);
  });

  it("handles going from empty to written, and back", () => {
    expect(changedLines("", doc("a", "b"))).toEqual([1, 2]);
    expect(changedLines(doc("a", "b"), "")).toEqual([1]);
  });

  it("does not run past the end of the new text", () => {
    const marks = changedLines(doc("a", "b", "c", "d", "e"), doc("a", "b"));
    for (const n of marks) expect(n).toBeLessThanOrEqual(2);
  });

  it("marks two distant edits as two places, not everything between", () => {
    // This used to paint all four: a to-do checked on the phone painted a
    // page amber, which read as "everything changed" in a note where one
    // line did.
    expect(changedLines(doc("a", "b", "c", "d"), doc("A", "b", "c", "D"))).toEqual([1, 4]);
  });

  it("marks one checked to-do among many lines, and only it", () => {
    const before = doc("# Day", "", "/TODO milk", "/TODO eggs", "/TODO bread", "", "notes");
    const after = doc("# Day", "", "/TODO milk", "/DONE eggs", "/TODO bread", "", "notes");
    expect(changedLines(before, after)).toEqual([4]);
  });

  it("marks an insertion and a rewrite far apart, separately", () => {
    const before = doc("a", "b", "c", "d", "e", "f");
    const after = doc("a", "b", "NEW", "c", "d", "E", "f");
    expect(changedLines(before, after)).toEqual([3, 6]);
  });

  it("marks a deletion in the middle at its junction, and a rewrite elsewhere", () => {
    // "c" removed — the junction is the line before the gap, "b", as for a
    // deletion at the end — and "f" rewritten.
    const before = doc("a", "b", "c", "d", "e", "f");
    const after = doc("a", "b", "d", "e", "F");
    expect(changedLines(before, after)).toEqual([2, 5]);
  });

  it("does not pair lines across a rewrite just because they repeat", () => {
    // Blank lines are everywhere; a rewrite between two of them must not be
    // read as "the blank moved".
    const before = doc("a", "", "b", "", "c");
    const after = doc("a", "", "B", "", "c");
    expect(changedLines(before, after)).toEqual([3]);
  });

  it("falls back to the span when the middle is too big to align", () => {
    const n = 2500; // 2500² > the cell budget
    const before = Array.from({ length: n }, (_, i) => `x${i}`).join("\n");
    const after = Array.from({ length: n }, (_, i) => `y${i}`).join("\n");
    const marks = changedLines(before, after);
    expect(marks.length).toBe(n);
    expect(marks[0]).toBe(1);
  });
});
