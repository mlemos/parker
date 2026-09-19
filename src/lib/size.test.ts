import { describe, expect, it } from "vitest";
import { fmtSize } from "./size.ts";

describe("fmtSize", () => {
  it("calls an empty file out by name", () => {
    expect(fmtSize(0)).toBe("Empty");
  });
  it("counts bytes below a kilobyte", () => {
    expect(fmtSize(1)).toBe("1B");
    expect(fmtSize(999)).toBe("999B");
  });
  it("rounds to whole kilobytes", () => {
    expect(fmtSize(1000)).toBe("1KB");
    expect(fmtSize(1499)).toBe("1KB");
    expect(fmtSize(1500)).toBe("2KB");
    expect(fmtSize(999_499)).toBe("999KB");
  });
  it("never says 1000KB", () => {
    // Rounding 999_500..999_999 to KB gives 1000 — that is a megabyte.
    expect(fmtSize(999_500)).toBe("1.0MB");
    expect(fmtSize(999_999)).toBe("1.0MB");
  });
  it("gives megabytes one decimal", () => {
    expect(fmtSize(1_000_000)).toBe("1.0MB");
    expect(fmtSize(1_250_000)).toBe("1.3MB");
    expect(fmtSize(12_345_678)).toBe("12.3MB");
  });
});
