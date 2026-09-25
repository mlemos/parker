// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTS_URL, SettingsWindow, initialSection } from "./SettingsWindow";
import type { AgentsInfo, SettingsBackend } from "./SettingsWindow";
import type { SettingsInfo } from "./lib/api";

const SETTINGS: SettingsInfo = {
  notes_dir: "/home/me/Documents/Parker",
  autostart: false,
  shortcut: "Ctrl+Alt+P",
  default_shortcut: "Ctrl+Alt+P",
  git_auto_sync: true,
  git_sync_interval: 15,
  zoom: 1,
  editor_gutter: true,
  editor_wrap: true,
  editor_ligatures: false,
  editor_width: 0,
  preview_sync: true,
};
const AGENTS: AgentsInfo = { claude_code: "missing", claude_code_dir: "~/.claude/skills/parker", readme: false };

/** A backend whose every call succeeds; tests override what they need.
 *  `emitPrefs` / `emitTheme` stand in for the other windows. */
function fakeBackend(over: Partial<SettingsBackend> = {}, agents: Partial<AgentsInfo> = {}) {
  let prefsCb: (p: Partial<SettingsInfo>) => void = () => {};
  let themeCb: (id: string) => void = () => {};
  const base = {
    getSettings: vi.fn(async () => ({ ...SETTINGS })),
    homeDir: vi.fn(async () => "/home/me"),
    setAutostart: vi.fn(async () => {}),
    pickNotesDir: vi.fn(async (): Promise<string | null> => "/home/me/Notes"),
    setNotesDir: vi.fn(async (p: string) => p),
    setShortcut: vi.fn(async (_accel: string) => {}),
    setGitAutoSync: vi.fn(async () => {}),
    setGitSyncInterval: vi.fn(async () => {}),
    setEditorPrefs: vi.fn(async () => {}),
    setPreviewSync: vi.fn(async () => {}),
    setTheme: vi.fn(async () => {}),
    agentsInfo: vi.fn(async () => ({ ...AGENTS, ...agents })),
    installClaudeCodeSkill: vi.fn(async () => {}),
    revealClaudeCodeSkill: vi.fn(async () => {}),
    saveSkillZip: vi.fn(async () => true),
    createStarterReadme: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    onTheme: vi.fn((cb: (id: string) => void) => {
      themeCb = cb;
      return () => {};
    }),
    onPrefs: vi.fn((cb: (p: Partial<SettingsInfo>) => void) => {
      prefsCb = cb;
      return () => {};
    }),
  } satisfies SettingsBackend;
  // Overrides are vi.fn()s too; keep the mock types for the assertions.
  const b = { ...base, ...over } as typeof base;
  return { b, emitPrefs: (p: Partial<SettingsInfo>) => prefsCb(p), emitTheme: (id: string) => themeCb(id) };
}

async function open(section: string, backend = fakeBackend()) {
  const user = userEvent.setup();
  render(<SettingsWindow backend={backend.b} initialTheme="parker-night" />);
  await screen.findByRole("heading", { name: "General" });
  if (section !== "General") await user.click(screen.getByRole("button", { name: section }));
  await screen.findByRole("heading", { name: section });
  return { user, ...backend };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("initialSection", () => {
  it("returns a known section and falls back to General", () => {
    expect(initialSection("agents")).toBe("agents");
    expect(initialSection("editor")).toBe("editor");
    expect(initialSection(null)).toBe("general");
    expect(initialSection("privacy")).toBe("general"); // a section that doesn't exist (yet)
  });
});

describe("SettingsWindow — sections", () => {
  it("lists the four sections and opens on General", async () => {
    await open("General");
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const names = within(nav).getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["General", "Editor", "Backup & Git", "AI Agents"]);
    expect(within(nav).getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");
  });

  // The window is hidden and shown, and re-created on each show; the section
  // you were in has to survive that.
  it("remembers the last section", async () => {
    await open("Backup & Git");
    expect(localStorage.getItem("parker.settings.section")).toBe("git");
    cleanup();
    render(<SettingsWindow backend={fakeBackend().b} />);
    expect(await screen.findByRole("heading", { name: "Backup & Git" })).toBeDefined();
  });
});

describe("SettingsWindow — General", () => {
  it("toggles launch at login", async () => {
    const { user, b } = await open("General");
    await user.click(screen.getByRole("switch", { name: "Launch at login" }));
    expect(b.setAutostart).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Launch at login" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("moves the notes only after the choice is confirmed", async () => {
    const { user, b } = await open("General");
    await user.click(screen.getByRole("button", { name: "Change…" }));
    expect(b.pickNotesDir).toHaveBeenCalledOnce();
    expect(b.setNotesDir).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Move my notes" }));
    expect(b.setNotesDir).toHaveBeenCalledWith("/home/me/Notes", true);
    // The README state belongs to the folder, so it is read again.
    await waitFor(() => expect(b.agentsInfo).toHaveBeenCalledTimes(2));
  });

  it("can switch without moving, or cancel", async () => {
    const { user, b } = await open("General");
    await user.click(screen.getByRole("button", { name: "Change…" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(b.setNotesDir).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Change…" }));
    await user.click(await screen.findByRole("button", { name: "Just switch" }));
    expect(b.setNotesDir).toHaveBeenCalledWith("/home/me/Notes", false);
  });

  it("asks nothing when the same folder is picked, or the picker is cancelled", async () => {
    const { user, b } = await open("General", fakeBackend({ pickNotesDir: vi.fn(async () => SETTINGS.notes_dir) }));
    await user.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.queryByRole("button", { name: "Move my notes" })).toBeNull();
    b.pickNotesDir.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.queryByRole("button", { name: "Move my notes" })).toBeNull();
  });

  it("records a new global shortcut, and Escape cancels", async () => {
    const { user, b } = await open("General");
    await user.click(screen.getByRole("button", { name: /⌃⌥P/ }));
    expect(screen.getByText(/Press the new shortcut/)).toBeDefined();
    await user.keyboard("{Escape}");
    expect(b.setShortcut).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /⌃⌥P/ }));
    await user.keyboard("{Meta>}{Shift>}k{/Shift}{/Meta}");
    expect(b.setShortcut).toHaveBeenCalledOnce();
    expect(b.setShortcut.mock.calls[0][0]).toMatch(/Shift/);
  });
});

describe("SettingsWindow — Editor", () => {
  it("sends every editor pref together, with just the one changed", async () => {
    const { user, b } = await open("Editor");
    await user.click(screen.getByRole("switch", { name: "Line numbers" }));
    expect(b.setEditorPrefs).toHaveBeenLastCalledWith(false, true, false, 0);
    await user.click(screen.getByRole("radio", { name: "80" }));
    await waitFor(() => expect(b.setEditorPrefs).toHaveBeenLastCalledWith(false, true, false, 80));
    await user.click(screen.getByRole("switch", { name: "Ligatures" }));
    await waitFor(() => expect(b.setEditorPrefs).toHaveBeenLastCalledWith(false, true, true, 80));
  });

  it("tells every window about a new theme", async () => {
    const { user, b } = await open("Editor");
    await user.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "matrix");
    expect(b.setTheme).toHaveBeenCalledWith("matrix");
  });

  // A toggle flipped in an editor window's top bar shows up here live.
  it("follows prefs changed in another window", async () => {
    const { emitPrefs } = await open("Editor");
    expect(screen.getByRole("switch", { name: "Wrap long lines" }).getAttribute("aria-checked")).toBe("true");
    act(() => emitPrefs({ editor_wrap: false }));
    expect(screen.getByRole("switch", { name: "Wrap long lines" }).getAttribute("aria-checked")).toBe("false");
  });

  it("follows a theme changed in another window", async () => {
    const { emitTheme } = await open("Editor");
    act(() => emitTheme("playa"));
    expect((screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement).value).toBe("playa");
    expect(document.documentElement.dataset.theme).toBe("playa");
  });
});

describe("SettingsWindow — Backup & Git", () => {
  it("sets the sync interval and sync on quit", async () => {
    const { user, b } = await open("Backup & Git");
    await user.click(screen.getByRole("radio", { name: "30 min" }));
    expect(b.setGitSyncInterval).toHaveBeenCalledWith(30);
    await user.click(screen.getByRole("switch", { name: "Sync on quit" }));
    expect(b.setGitAutoSync).toHaveBeenCalledWith(false);
  });
});

describe("SettingsWindow — AI Agents", () => {
  it("installs the skill for Claude Code when it is missing", async () => {
    const be = fakeBackend();
    const { user, b } = await open("AI Agents", be);
    expect(await screen.findByText("Not installed")).toBeDefined();
    b.agentsInfo.mockResolvedValue({ ...AGENTS, claude_code: "current" });
    await user.click(screen.getByRole("button", { name: "Install" }));
    expect(b.installClaudeCodeSkill).toHaveBeenCalledOnce();
    expect(await screen.findByText("Installed")).toBeDefined();
    expect(screen.getByRole("status").textContent).toMatch(/Installed/);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("offers Update over another version, and says it replaces it", async () => {
    await open("AI Agents", fakeBackend({}, { claude_code: "different" }));
    expect(await screen.findByRole("button", { name: "Update" })).toBeDefined();
    expect(screen.getByText("Another version")).toBeDefined();
    expect(screen.getByText(/Updating replaces it/)).toBeDefined();
  });

  it("shows the installed skill in the Finder", async () => {
    const { user, b } = await open("AI Agents", fakeBackend({}, { claude_code: "current" }));
    await user.click(await screen.findByRole("button", { name: "Show in Finder" }));
    expect(b.revealClaudeCodeSkill).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Install|Update/ })).toBeNull();
  });

  it("saves the zip for the Claude app, and stays quiet when cancelled", async () => {
    const { user, b } = await open("AI Agents");
    b.saveSkillZip.mockResolvedValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Save parker-skill.zip…" }));
    expect(screen.queryByRole("status")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save parker-skill.zip…" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Upload a skill/);
  });

  it("creates the starter README only when the folder has none", async () => {
    const { user, b } = await open("AI Agents");
    b.agentsInfo.mockResolvedValue({ ...AGENTS, readme: true });
    await user.click(await screen.findByRole("button", { name: "Create README.md" }));
    expect(b.createStarterReadme).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Create README.md" })).toBeNull());
    expect(screen.getByText(/Your notes folder has a README/)).toBeDefined();
  });

  it("points other agents at the /agents page", async () => {
    const { user, b } = await open("AI Agents");
    await user.click(screen.getByRole("button", { name: "getparker.dev/agents" }));
    expect(b.openUrl).toHaveBeenCalledWith(AGENTS_URL);
  });

  it("shows a failure where it happened", async () => {
    const { user } = await open(
      "AI Agents",
      fakeBackend({ installClaudeCodeSkill: vi.fn(async () => { throw new Error("Couldn't write ~/.claude/skills/parker/SKILL.md"); }) })
    );
    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't write/);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
