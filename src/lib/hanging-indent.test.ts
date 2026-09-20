import { describe, expect, it } from "vitest";
import { hangingPrefix, hangingStyle } from "./hanging-indent.ts";

import fixtures from "../../shared/fixtures/hanging-indent.json";

// The prefix rule is shared with the iPhone (ios/ParkerCore HangingIndent):
// both suites read the same cases, so the two editors hang the same lines
// under the same column.
describe("hangingPrefix", () => {
  for (const c of fixtures.cases) {
    it(`${JSON.stringify(c.line)} → ${c.cols === null ? "no prefix" : `${c.cols} cols${c.box ? " + box" : ""}`}`, () => {
      expect(hangingPrefix(c.line)).toEqual(c.cols === null ? null : { cols: c.cols, box: c.box });
    });
  }
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
