import { describe, expect, it } from "vitest";
import { ARCHIVE, latestJson } from "./gen-latest-json.mjs";

describe("latest.json", () => {
  it("points Apple Silicon at the release's archive, signed", () => {
    const j = latestJson({ version: "1.5.0", notes: "- New", signature: "  c2ln\n", date: 0 });
    expect(j.version).toBe("1.5.0");
    expect(j.pub_date).toBe("1970-01-01T00:00:00.000Z");
    expect(j.platforms["darwin-aarch64"]).toEqual({
      signature: "c2ln",
      url: `https://github.com/mlemos/parker/releases/download/v1.5.0/${ARCHIVE}`,
    });
    expect(Object.keys(j.platforms)).toEqual(["darwin-aarch64"]); // no Intel entry
  });

  it("refuses a version or a signature that isn't there", () => {
    expect(() => latestJson({ version: "v1.5", signature: "x", date: 0 })).toThrow();
    expect(() => latestJson({ version: "1.5.0", signature: " ", date: 0 })).toThrow();
  });
});
