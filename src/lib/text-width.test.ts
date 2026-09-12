import { describe, expect, it } from "vitest";
import { TEXT_WIDTHS, textWidthOf } from "./text-width.ts";

// The saved value comes from a JSON file anyone can edit; the editor must
// only ever see one of the choices Settings offers.

describe("text width", () => {
  it("keeps a saved value that is one of the choices", () => {
    for (const w of TEXT_WIDTHS) expect(textWidthOf(w)).toBe(w);
  });

  it("falls back to the window for anything else", () => {
    expect(textWidthOf(90)).toBe(0);
    expect(textWidthOf(-1)).toBe(0);
    expect(textWidthOf(NaN)).toBe(0);
  });
});
