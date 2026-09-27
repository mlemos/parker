import { describe, expect, it } from "vitest";
import { checkResult, progressLabel } from "./updates";

describe("the update's words", () => {
  it("counts the download, then says it's installing", () => {
    expect(progressLabel(0, 10_000_000)).toBe("Downloading… 0%");
    expect(progressLabel(4_200_000, 10_000_000)).toBe("Downloading… 42%");
    expect(progressLabel(10_000_000, 10_000_000)).toBe("Installing…");
    expect(progressLabel(0, null)).toBe("Downloading…");
    expect(progressLabel(3_500_000, null)).toBe("Downloading… 3.5 MB");
  });

  it("says what Check for Updates… found", () => {
    expect(checkResult("1.5.0", null)).toBe("You're up to date — Parker 1.5.0.");
    expect(checkResult("1.5.0", { version: "1.5.1", current: "1.5.0", notes: "" })).toBe("Parker 1.5.1 is available.");
    expect(checkResult("1.5.0", null, "offline")).toBe("Couldn't check for updates: offline");
  });
});
