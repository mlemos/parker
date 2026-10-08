// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: { copyText: vi.fn(), doubleClickMs: vi.fn(), revealNote: vi.fn() },
}));
import { api } from "../lib/api.ts";
import { FLASH_MS, StatusPath } from "./StatusPath.tsx";

const copyText = vi.mocked(api.copyText);
const reveal = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  copyText.mockReset().mockResolvedValue(undefined);
  vi.mocked(api.doubleClickMs).mockResolvedValue(500);
  reveal.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const note = () =>
  render(
    <StatusPath className="status-file" full="/n/backlogs/p.md" relative="backlogs/p.md" reveal={reveal}>
      backlogs/p.md
    </StatusPath>
  );
const label = () => screen.getByRole("button");
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400); });

describe("StatusPath", () => {
  it("a click copies the whole path, then says so, then goes back", async () => {
    note();
    fireEvent.click(label(), { detail: 1 });
    expect(copyText).not.toHaveBeenCalled(); // waits: it may be half a double click
    await settle();
    expect(copyText).toHaveBeenCalledWith("/n/backlogs/p.md");
    expect(label().textContent).toContain("✓ Path copied");
    await act(async () => { await vi.advanceTimersByTimeAsync(FLASH_MS); });
    expect(label().textContent).toBe("backlogs/p.md");
  });

  // Seen in Parker Dev: the status bar re-renders with every caret move, and
  // a re-render inside the double-click wait used to cancel the click.
  it("a re-render while the click waits doesn't lose it", async () => {
    const { rerender } = note();
    fireEvent.click(label(), { detail: 1 });
    rerender(
      <StatusPath className="status-file" full="/n/backlogs/p.md" relative="backlogs/p.md" reveal={() => reveal()}>
        backlogs/p.md
      </StatusPath>
    );
    await settle();
    expect(copyText).toHaveBeenCalledWith("/n/backlogs/p.md");
  });

  it("⌥-click copies the path in your notes", async () => {
    note();
    fireEvent.click(label(), { detail: 1, altKey: true });
    await settle();
    expect(copyText).toHaveBeenCalledWith("backlogs/p.md");
    expect(label().textContent).toContain("✓ Relative path copied");
  });

  it("a double click shows the Finder and copies nothing", async () => {
    note();
    fireEvent.click(label(), { detail: 1 });
    fireEvent.click(label(), { detail: 2 });
    fireEvent.doubleClick(label());
    await settle();
    expect(reveal).toHaveBeenCalledOnce();
    expect(copyText).not.toHaveBeenCalled();
    expect(label().textContent).toContain("✓ Shown in Finder");
  });

  it("a draft has no path: it says it isn't saved yet", async () => {
    render(
      <StatusPath className="status-file" full={null} unsaved="Not saved yet" reveal={reveal}>
        Untitled · not saved yet
      </StatusPath>
    );
    fireEvent.click(label(), { detail: 1 });
    await settle();
    expect(copyText).not.toHaveBeenCalled();
    expect(label().textContent).toContain("Not saved yet");
  });
});
