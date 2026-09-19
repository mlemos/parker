import { describe, expect, it } from "vitest";
import { isFirstLaunch } from "./session.ts";

describe("isFirstLaunch", () => {
  it("is true when nothing was ever saved", () => {
    expect(isFirstLaunch({ open: [], active: null, theme: null })).toBe(true);
  });
  it("is false for a session with notes open", () => {
    expect(isFirstLaunch({ open: ["a.md"], active: "a.md", theme: null })).toBe(false);
  });
  it("is false for a session whose panes are empty — the pane was emptied on purpose", () => {
    expect(
      isFirstLaunch({
        open: [],
        active: null,
        theme: null,
        layout: { id: "g", kind: "group", tabs: [], active: null, mode: "edit" },
      })
    ).toBe(false);
  });
  it("tolerates a session file from before `open` existed", () => {
    expect(isFirstLaunch({ active: null, theme: null } as never)).toBe(true);
  });
});
