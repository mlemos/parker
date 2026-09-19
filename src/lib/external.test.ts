import { describe, expect, it } from "vitest";
import { displayName, isExternal } from "./external.ts";

describe("isExternal", () => {
  it("is the leading slash", () => {
    expect(isExternal("/Users/me/repo/README.md")).toBe(true);
    expect(isExternal("README.md")).toBe(false);
    expect(isExternal("a/b.md")).toBe(false); // never a note name, never a path
  });
  it("is false for nothing", () => {
    expect(isExternal(null)).toBe(false);
    expect(isExternal(undefined)).toBe(false);
    expect(isExternal("")).toBe(false);
  });
});

describe("displayName", () => {
  it("shows the filename of a path", () => {
    expect(displayName("/Users/me/repo/README.md")).toBe("README.md");
    expect(displayName("/notes.md")).toBe("notes.md");
  });
  it("leaves a note name alone", () => {
    expect(displayName("Inbox.md")).toBe("Inbox.md");
  });
});
