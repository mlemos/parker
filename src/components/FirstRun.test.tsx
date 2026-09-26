// @vitest-environment jsdom
// The Mac's first open, driven the way a new person goes through it: say
// hello, look in Documents (or not), see what's there, pick, continue.
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstRun } from "./FirstRun";
import type { FirstRunBackend } from "./FirstRun";
import type { FolderInfo, ICloudState } from "../lib/first-run";

const DOCS: FolderInfo = {
  path: "/home/me/Documents/Parker",
  display: "Documents › Parker",
  exists: true,
  readable: true,
  notes: 42,
  other: 0,
  git: false,
  git_remote: null,
  sync: { service: "icloud", label: "iCloud Drive" },
};
const NOTES: FolderInfo = { ...DOCS, path: "/home/me/Notes", display: "~/Notes", notes: 7, other: 2, sync: { service: "unknown", label: "" } };

function setup(over: Partial<FirstRunBackend> = {}, icloud: ICloudState = { drive: true, documents: true }) {
  const b = {
    lookForNotes: vi.fn(async () => DOCS),
    inspect: vi.fn(async (p: string) => (p === NOTES.path ? NOTES : DOCS)),
    icloud: vi.fn(async () => icloud),
    pickFolder: vi.fn(async (): Promise<string | null> => NOTES.path),
    openSystemSettings: vi.fn(async () => {}),
    finish: vi.fn(async (): Promise<string | null> => null),
    ...over,
  };
  const onDone = vi.fn();
  render(<FirstRun backend={b} onDone={onDone} />);
  return { b, onDone, user: userEvent.setup() };
}

afterEach(cleanup);

describe("FirstRun", () => {
  it("says hello and looks only when asked to", async () => {
    const { b } = setup();
    expect(screen.getByRole("heading", { name: "Hi, I'm Parker." })).toBeDefined();
    expect(b.lookForNotes).not.toHaveBeenCalled(); // macOS's prompt comes explained
  });

  it("finds the notes in Documents, then explains the choice and continues", async () => {
    const { b, onDone, user } = setup();
    await user.click(screen.getByRole("button", { name: "Look in Documents" }));
    expect(await screen.findByRole("heading", { name: "Nice — your notes are right here." })).toBeDefined();
    expect(screen.getAllByText("42 notes").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(await screen.findByRole("heading", { name: "Here's your setup." })).toBeDefined();
    expect(screen.getByText("Yes — the folder I suggest.")).toBeDefined();
    expect(screen.getByText(/Continue with iCloud Drive — it finds this folder by itself/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(b.finish).toHaveBeenCalledWith(DOCS.path);
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it("offers a fresh start when there's nothing, and warns iCloud may still be bringing it", async () => {
    const { user } = setup({ lookForNotes: vi.fn(async () => ({ ...DOCS, exists: false, notes: 0 })) });
    await user.click(screen.getByRole("button", { name: "Look in Documents" }));
    expect(await screen.findByRole("heading", { name: "Fresh start." })).toBeDefined();
    expect(screen.getByText(/iCloud may still be bringing that folder here/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Create it" })).toBeDefined();
  });

  it("makes 'Don't Allow' a path, not a dead end", async () => {
    const { b, user } = setup({ lookForNotes: vi.fn(async () => ({ ...DOCS, exists: false, readable: false, notes: 0 })) });
    await user.click(screen.getByRole("button", { name: "Look in Documents" }));
    expect(await screen.findByRole("heading", { name: "No worries." })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Open Privacy Settings" }));
    expect(b.openSystemSettings).toHaveBeenCalledWith("privacy");
    await user.click(screen.getByRole("button", { name: "Choose a folder…" }));
    expect(await screen.findByRole("heading", { name: "Here's your setup." })).toBeDefined();
    expect(screen.getByText(/Your pick — works just the same/)).toBeDefined();
  });

  it("takes a folder of your own, says what's in it, and goes back", async () => {
    const { b, user } = setup();
    await user.click(screen.getByRole("button", { name: "Choose a folder myself instead" }));
    expect(await screen.findByText("~/Notes")).toBeDefined();
    expect(screen.getByText("Exists, with 7 notes and 2 other files Parker leaves alone.")).toBeDefined();
    // Not in iCloud: "Other ways to sync" is open.
    expect((screen.getByText("Other ways to sync").closest("details") as HTMLDetailsElement).open).toBe(true);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Hi, I'm Parker." })).toBeDefined();
    expect(b.finish).not.toHaveBeenCalled(); // nothing made by going back
  });

  it("recommends Desktop & Documents and updates by itself when you come back", async () => {
    let docsOn = false;
    const local = { ...DOCS, sync: { service: "local", label: "this Mac" } };
    const { b, user } = setup({
      lookForNotes: vi.fn(async () => local),
      inspect: vi.fn(async () => (docsOn ? DOCS : local)),
      icloud: vi.fn(async () => ({ drive: true, documents: docsOn })),
    });
    await user.click(screen.getByRole("button", { name: "Look in Documents" }));
    await user.click(await screen.findByRole("button", { name: "Use this folder" }));
    expect(screen.getByText(/Stays on this Mac — your Documents folder isn't in iCloud/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Open iCloud Settings" }));
    expect(b.openSystemSettings).toHaveBeenCalledWith("icloud");
    docsOn = true; // turned on in System Settings, then back to Parker
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText(/Desktop & Documents is on. Your notes will follow you/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open iCloud Settings" })).toBeNull();
  });

  it("stays put when the Open panel is cancelled", async () => {
    const { user } = setup({ pickFolder: vi.fn(async () => null) });
    await user.click(screen.getByRole("button", { name: "Choose a folder myself instead" }));
    expect(screen.getByRole("heading", { name: "Hi, I'm Parker." })).toBeDefined();
  });
});
