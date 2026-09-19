import { describe, expect, it } from "vitest";
import { displayName, droppedExternals, isExternal, splitPath } from "./external.ts";

describe("isExternal", () => {
  it("is the leading slash", () => {
    expect(isExternal("/Volumes/work/repo/README.md")).toBe(true);
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
    expect(displayName("/Volumes/work/repo/README.md")).toBe("README.md");
    expect(displayName("/notes.md")).toBe("notes.md");
  });
  it("leaves a note name alone", () => {
    expect(displayName("Inbox.md")).toBe("Inbox.md");
  });
});

describe("splitPath", () => {
  it("keeps folder and file whole in the tail", () => {
    expect(splitPath("/Volumes/work/Projects/parker/README.md")).toEqual({
      head: "/Volumes/work/Projects",
      tail: "/parker/README.md",
    });
  });
  it("works on the ~ form", () => {
    expect(splitPath("~/Projects/repo/README.md")).toEqual({
      head: "~/Projects",
      tail: "/repo/README.md",
    });
  });
  it("has no head to lose when the path is already short", () => {
    expect(splitPath("~/README.md")).toEqual({ head: "", tail: "~/README.md" });
    expect(splitPath("/a/b.md")).toEqual({ head: "", tail: "/a/b.md" });
  });
});

describe("droppedExternals", () => {
  const b = (name: string) => ({ name });
  it("names the outside files that vanished", () => {
    expect(
      droppedExternals([b("a.md"), b("/Volumes/work/x.md"), b("/Volumes/work/y.md")], [b("a.md"), b("/Volumes/work/y.md")])
    ).toEqual(["/Volumes/work/x.md"]);
  });
  it("ignores notes, which Rust never admitted by path", () => {
    expect(droppedExternals([b("a.md"), b("b.md")], [b("b.md")])).toEqual([]);
  });
  it("is empty when nothing left, or when files only arrived", () => {
    expect(droppedExternals([b("/Volumes/work/x.md")], [b("/Volumes/work/x.md")])).toEqual([]);
    expect(droppedExternals([], [b("/Volumes/work/x.md")])).toEqual([]);
  });
});
