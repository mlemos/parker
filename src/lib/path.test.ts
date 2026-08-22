import { describe, expect, it } from "vitest";
import { prettyPath } from "./path.ts";

const HOME = "/home/tester";

describe("prettyPath", () => {
  it("abbreviates the home folder", () => {
    expect(prettyPath(`${HOME}/Documents/Parker`, HOME)).toBe("~/Documents/Parker");
  });

  it("abbreviates the home folder itself", () => {
    expect(prettyPath(HOME, HOME)).toBe("~");
  });

  it("leaves paths outside home alone", () => {
    expect(prettyPath("/etc/hosts", HOME)).toBe("/etc/hosts");
  });

  it("does not abbreviate a sibling that merely starts with the same letters", () => {
    // "/home/tester2" is not inside "/home/tester" — only a "/" boundary counts.
    expect(prettyPath("/home/tester2/notes", HOME)).toBe("/home/tester2/notes");
  });

  it("passes the path through when home is unknown", () => {
    expect(prettyPath("/some/path", "")).toBe("/some/path");
  });

  it("passes an empty path through", () => {
    expect(prettyPath("", HOME)).toBe("");
  });
});
