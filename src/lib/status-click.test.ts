import { describe, expect, it, vi } from "vitest";
import { clickGate, clickWait, fullPath, pathToCopy } from "./status-click.ts";

function fakeTimers() {
  let next = 1;
  const due = new Map<number, () => void>();
  return {
    set: (f: () => void) => (due.set(next, f), next++),
    clear: (id: number) => void due.delete(id),
    fire: () => {
      const fs = [...due.values()];
      due.clear();
      fs.forEach((f) => f());
    },
    pending: () => due.size,
  };
}

describe("clickWait", () => {
  it("is the Mac's double-click time, capped", () => {
    expect(clickWait(500)).toBe(300);
    expect(clickWait(200)).toBe(200);
    expect(clickWait(null)).toBe(300);
    expect(clickWait(0)).toBe(300);
  });
});

describe("clickGate", () => {
  it("a click acts once the wait is over", () => {
    const t = fakeTimers();
    const single = vi.fn();
    const double = vi.fn();
    const g = clickGate(() => 250, single, double, t);
    g.click(false);
    expect(single).not.toHaveBeenCalled(); // not yet: it may be half a double
    t.fire();
    expect(single).toHaveBeenCalledWith(false);
    expect(double).not.toHaveBeenCalled();
  });

  it("a double click is a double only — the first click never acts", () => {
    const t = fakeTimers();
    const single = vi.fn();
    const double = vi.fn();
    const g = clickGate(() => 250, single, double, t);
    g.click(false);
    g.double();
    t.fire();
    expect(double).toHaveBeenCalledOnce();
    expect(single).not.toHaveBeenCalled();
  });

  it("keeps ⌥ from the click", () => {
    const t = fakeTimers();
    const single = vi.fn();
    clickGate(() => 250, single, vi.fn(), t).click(true);
    t.fire();
    expect(single).toHaveBeenCalledWith(true);
  });

  it("forgets a pending click when cancelled", () => {
    const t = fakeTimers();
    const single = vi.fn();
    const g = clickGate(() => 250, single, vi.fn(), t);
    g.click(false);
    g.cancel();
    expect(t.pending()).toBe(0);
  });
});

describe("paths", () => {
  it("copies the whole path, or with ⌥ the note's path in the folder", () => {
    expect(pathToCopy("/n/backlogs/p.md", "backlogs/p.md", false)).toEqual({ text: "/n/backlogs/p.md", relative: false });
    expect(pathToCopy("/n/backlogs/p.md", "backlogs/p.md", true)).toEqual({ text: "backlogs/p.md", relative: true });
    // A file from outside the folder has no path in it: ⌥ copies the whole one.
    expect(pathToCopy("/elsewhere/x.md", null, true)).toEqual({ text: "/elsewhere/x.md", relative: false });
  });

  it("builds a note's whole path from the notes folder", () => {
    expect(fullPath("/home/me/Documents/Parker", "backlogs/p.md")).toBe("/home/me/Documents/Parker/backlogs/p.md");
    expect(fullPath("/home/me/Documents/Parker/", "p.md")).toBe("/home/me/Documents/Parker/p.md");
    expect(fullPath("/home/me/Documents/Parker", "/Volumes/x/y.md")).toBe("/Volumes/x/y.md");
  });
});
