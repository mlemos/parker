// @vitest-environment jsdom
// The update sheet: three ways out, nothing downloaded before the first, and
// no way to wander off while it works.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateSheet } from "./UpdateSheet";

const UPDATE = { version: "1.5.1", current: "1.5.0", notes: "- Faster search\n- ![x](https://tracker.example/p.gif)" };

function sheet(over: Partial<Parameters<typeof UpdateSheet>[0]> = {}) {
  const props = {
    update: UPDATE,
    current: "1.5.0",
    blocked: null,
    progress: null,
    error: null,
    onInstall: vi.fn(),
    onLater: vi.fn(),
    onSkip: vi.fn(),
    ...over,
  };
  render(<UpdateSheet {...props} />);
  return props;
}

afterEach(cleanup);

describe("UpdateSheet", () => {
  it("offers the version with its notes, and three ways out", () => {
    const p = sheet();
    expect(screen.getByText("Parker 1.5.1 is available")).toBeDefined();
    expect(screen.getByText("Faster search")).toBeDefined();
    // Release notes fetch nothing: images are off in them.
    expect(document.querySelector(".update-notes img")).toBeNull();
    fireEvent.click(screen.getByText("Update & Restart"));
    fireEvent.click(screen.getByText("Later"));
    fireEvent.click(screen.getByText("Skip This Version"));
    expect(p.onInstall).toHaveBeenCalledOnce();
    expect(p.onLater).toHaveBeenCalledOnce();
    expect(p.onSkip).toHaveBeenCalledOnce();
  });

  it("counts the download and can't be dismissed while it works", () => {
    const p = sheet({ progress: { got: 5, total: 10 } });
    expect(screen.getByText("Downloading… 50%")).toBeDefined();
    expect((screen.getByText("Later") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onLater).not.toHaveBeenCalled();
  });

  it("says why a copy run from the disk image can't update, and doesn't try", () => {
    sheet({ blocked: "Parker is running from its disk image. Move Parker to your Applications folder to update it." });
    expect(screen.getByRole("note").textContent).toMatch(/disk image/);
    expect((screen.getByText("Update & Restart") as HTMLButtonElement).disabled).toBe(true);
  });

  it("answers a check that found nothing, or failed", () => {
    sheet({ update: null, result: { status: "none" } });
    expect(screen.getByText("You're up to date")).toBeDefined();
    expect(screen.getByText("You're up to date — Parker 1.5.0.")).toBeDefined();
    cleanup();
    sheet({ update: null, result: { status: "error", message: "offline" } });
    expect(screen.getByText("Couldn't check for updates")).toBeDefined();
  });
});
