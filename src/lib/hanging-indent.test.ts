import { describe, expect, it } from "vitest";
import { hangingPrefix, hangingStyle } from "./hanging-indent.ts";

describe("hangingPrefix", () => {
  it("hangs a list item under its text", () => {
    expect(hangingPrefix("- item")).toEqual({ cols: 2, box: false });
    expect(hangingPrefix("* item")).toEqual({ cols: 2, box: false });
    expect(hangingPrefix("+ item")).toEqual({ cols: 2, box: false });
    expect(hangingPrefix("12. item")).toEqual({ cols: 4, box: false });
    expect(hangingPrefix("3) item")).toEqual({ cols: 3, box: false });
  });

  it("counts the indentation of a nested item", () => {
    expect(hangingPrefix("  - detail")).toEqual({ cols: 4, box: false });
    expect(hangingPrefix("    - deeper")).toEqual({ cols: 6, box: false });
    expect(hangingPrefix("\t- tabbed")).toEqual({ cols: 3, box: false });
  });

  it("includes a task checkbox in the prefix", () => {
    expect(hangingPrefix("- [ ] task")).toEqual({ cols: 6, box: false });
    expect(hangingPrefix("- [x] done")).toEqual({ cols: 6, box: false });
  });

  it("hangs a quote under its text", () => {
    expect(hangingPrefix("> quoted")).toEqual({ cols: 2, box: false });
  });

  it("stands the to-do box in for the tag, and keeps the space", () => {
    expect(hangingPrefix("/TODO buy milk")).toEqual({ cols: 1, box: true });
    expect(hangingPrefix("/DONE!! shipped")).toEqual({ cols: 1, box: true });
    expect(hangingPrefix("  /WAIT on them")).toEqual({ cols: 3, box: true });
  });

  it("hangs indented plain text under its own start", () => {
    expect(hangingPrefix("  continuation of the item above")).toEqual({ cols: 2, box: false });
  });

  it("leaves a paragraph, a heading and a blank line alone", () => {
    expect(hangingPrefix("Just a paragraph that wraps")).toBeNull();
    expect(hangingPrefix("# Heading")).toBeNull();
    expect(hangingPrefix("")).toBeNull();
    expect(hangingPrefix("   ")).toBeNull();
  });

  it("does not take a dash in prose for a marker", () => {
    expect(hangingPrefix("-not a list")).toBeNull();
    expect(hangingPrefix("2024 was a year")).toBeNull();
  });
});

describe("hangingStyle", () => {
  it("pads by the prefix and indents back by the same", () => {
    expect(hangingStyle({ cols: 2, box: false })).toBe(
      "padding-left: calc(6px + 2ch); text-indent: calc(-1 * (2ch));"
    );
  });
  it("adds the box's width for a to-do", () => {
    expect(hangingStyle({ cols: 1, box: true })).toBe(
      "padding-left: calc(6px + calc(1ch + 0.95em + 4px)); text-indent: calc(-1 * (calc(1ch + 0.95em + 4px)));"
    );
  });
});
