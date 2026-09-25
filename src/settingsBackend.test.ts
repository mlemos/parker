// The Settings window changes things the editor windows have to hear about.
// These pin the wiring: which command each control calls, and which app-wide
// event goes out after it — the editor windows listen for exactly these.
import { beforeEach, describe, expect, it, vi } from "vitest";

const emit = vi.fn(async (..._a: unknown[]) => {});
const listeners: Record<string, (e: { payload: unknown }) => void> = {};
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...a: unknown[]) => emit(...a),
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners[name] = cb;
    return unlisten;
  }),
}));
const calls: string[] = [];
vi.mock("./lib/api", () => ({
  api: new Proxy({}, { get: (_, k: string) => vi.fn(async () => { calls.push(k); }) }),
}));
const openExternal = vi.fn((_url: string) => true);
vi.mock("./lib/open", () => ({ openExternal: (u: string) => openExternal(u) }));

import { tauriBackend } from "./settingsBackend";
import { SYNC_INTERVAL_EVENT } from "./components/GitMenu";

beforeEach(() => {
  calls.length = 0;
});

describe("tauriBackend", () => {
  // The git timer lives in the editor window; it only re-reads the interval
  // when this event arrives, and only after the new value is saved.
  it("saves the sync interval, then tells the editor's timer", async () => {
    await tauriBackend.setGitSyncInterval(30);
    expect(calls).toEqual(["setGitSyncInterval"]);
    expect(emit).toHaveBeenCalledWith(SYNC_INTERVAL_EVENT);
  });

  it("sends a theme to every window", async () => {
    await tauriBackend.setTheme("matrix");
    expect(emit).toHaveBeenCalledWith("parker://theme", "matrix");
  });

  it("opens links outside the app", async () => {
    await tauriBackend.openUrl("https://getparker.dev/agents");
    expect(openExternal).toHaveBeenCalledWith("https://getparker.dev/agents");
  });

  it("hears themes and prefs from the other windows, and lets go", async () => {
    const theme = vi.fn();
    const prefs = vi.fn();
    const offTheme = tauriBackend.onTheme(theme);
    const offPrefs = tauriBackend.onPrefs(prefs);
    await Promise.resolve();
    listeners["parker://theme"]({ payload: "playa" });
    listeners["parker://prefs"]({ payload: { editor_wrap: false } });
    expect(theme).toHaveBeenCalledWith("playa");
    expect(prefs).toHaveBeenCalledWith({ editor_wrap: false });
    offTheme();
    offPrefs();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
