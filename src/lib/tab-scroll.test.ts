import { describe, expect, it } from "vitest";
import { tabScrollTarget } from "./tab-scroll";

describe("tabScrollTarget", () => {
  it("leaves a tab that is already in view alone", () => {
    expect(tabScrollTarget(0, 400, 100, 120)).toBeNull();
  });

  it("scrolls right to a tab past the end, with a margin", () => {
    // Tab spans 500–620; the view must end at 628.
    expect(tabScrollTarget(0, 400, 500, 120)).toBe(228);
  });

  it("scrolls left to a tab before the start, with a margin", () => {
    expect(tabScrollTarget(300, 400, 100, 120)).toBe(92);
  });

  it("brings a partly hidden tab fully in", () => {
    // Right edge (350 + 8) past the view's end at 340.
    expect(tabScrollTarget(0, 340, 250, 100)).toBe(18);
  });

  it("never scrolls before the strip's start", () => {
    expect(tabScrollTarget(50, 400, 0, 120)).toBe(0);
  });

  it("shows the start of a tab wider than the strip", () => {
    expect(tabScrollTarget(0, 100, 300, 200)).toBe(292);
  });
});
