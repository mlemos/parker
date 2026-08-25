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

  it("is coarse between two distant edits, and says so honestly", () => {
    // Both ends changed; everything between is marked. Documented, not a bug.
    expect(changedLines(doc("a", "b", "c", "d"), doc("A", "b", "c", "D"))).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
