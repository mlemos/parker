// @vitest-environment jsdom
// The Settings window is hidden, not closed, and remounts each time it comes
// back. It must come back in the theme in force then — not the one in the URL
// it was created with, which is how a light theme picked in it reopened dark.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const listeners: Record<string, (e: { payload: unknown }) => void> = {};
const listenAs = (name: string, cb: (e: { payload: unknown }) => void) => {
  listeners[name] = cb;
  return Promise.resolve(() => {});
};
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(listenAs), emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: vi.fn(listenAs) }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ show: async () => {}, setFocus: async () => {}, close: async () => {} }),
}));
vi.mock("./settingsBackend", () => ({ tauriBackend: {} }));
const mounted = vi.hoisted(() => [] as (string | undefined)[]);
vi.mock("./SettingsWindow", () => ({
  applyWindowTheme: () => {},
  SettingsWindow: ({ initialTheme }: { initialTheme?: string }) => {
    mounted.push(initialTheme);
    return null;
  },
}));

afterEach(cleanup);

it("comes back in the theme picked while it was open, not the one it opened with", async () => {
  window.history.replaceState(null, "", "/?view=settings&theme=parker-night");
  const { default: SettingsRoot } = await import("./SettingsRoot");
  render(<SettingsRoot />);
  expect(mounted[mounted.length - 1]).toBe("parker-night");

  // A light theme is picked, then the window is closed (hidden) and reopened.
  act(() => listeners["parker://theme"]({ payload: "parker-day" }));
  act(() => listeners["parker://settings-shown"]({ payload: null }));
  expect(mounted[mounted.length - 1]).toBe("parker-day");
});
