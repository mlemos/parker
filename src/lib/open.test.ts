import { describe, expect, it } from "vitest";
import { externalUrl } from "./open.ts";

describe("what counts as a link to the outside", () => {
  it("passes web and mail addresses through", () => {
    expect(externalUrl("https://getparker.dev/x?y=1")).toBe("https://getparker.dev/x?y=1");
    expect(externalUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(externalUrl("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(externalUrl("  HTTPS://X.IO  ")).toBe("HTTPS://X.IO");
  });

  it("completes the forms markdown autolinks accept without a scheme", () => {
    expect(externalUrl("www.example.org/a")).toBe("https://www.example.org/a");
    expect(externalUrl("someone@example.com")).toBe("mailto:someone@example.com");
  });

  it("refuses what the browser should not be handed", () => {
    expect(externalUrl("#heading")).toBeNull();
    expect(externalUrl("other-note.md")).toBeNull();
    expect(externalUrl("/etc/passwd")).toBeNull();
    expect(externalUrl("javascript:alert(1)")).toBeNull();
    expect(externalUrl("file:///Users/x")).toBeNull();
    expect(externalUrl("")).toBeNull();
  });
});
