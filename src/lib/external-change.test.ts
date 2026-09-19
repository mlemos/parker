import { describe, expect, it } from "vitest";
import { changeRecord, whitespaceOnly } from "./external-change.ts";

describe("whitespaceOnly", () => {
  it("sees a trailing newline, CRLF and trailing spaces as a tool's fingerprint", () => {
    expect(whitespaceOnly("a\nb", "a\nb\n")).toBe(true);
    expect(whitespaceOnly("a\nb", "a\r\nb")).toBe(true);
    expect(whitespaceOnly("a \nb", "a\nb")).toBe(true);
  });
  it("is false for a real edit, and for identical text", () => {
    expect(whitespaceOnly("a\nb", "a\nB")).toBe(false);
    expect(whitespaceOnly("a\nb", "a\nb")).toBe(false);
  });
});

describe("changeRecord", () => {
  it("is one JSON line with a timestamp in front", () => {
    const line = changeRecord({
      name: "n.md",
      verdict: "reload",
      baseline: 10,
      disk: 12,
      lines: [3],
      whitespaceOnly: false,
      ownSeq: 4,
      ownMatches: false,
    });
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed).toMatchObject({ name: "n.md", verdict: "reload", lines: [3], ownSeq: 4 });
  });
});
