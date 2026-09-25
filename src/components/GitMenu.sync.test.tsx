// @vitest-environment jsdom
// The timed git sync: the interval lives in Rust settings, the clock in
// GitMenu. The Settings window is another window now, so a new interval
// reaches the timer only through the app-wide SYNC_INTERVAL_EVENT — these pin
// that path, and what a tick does once it fires.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "../lib/api";

const listeners: Record<string, () => void> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: () => void) => {
    listeners[name] = cb;
    return () => {};
  }),
}));

const state = vi.hoisted(() => ({ interval: 0, status: null as unknown }));
const api = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ git_sync_interval: state.interval })),
  gitStatus: vi.fn(async () => state.status),
  gitLog: vi.fn(async () => []),
  gitCommit: vi.fn(async (_message: string, _push: boolean) => ({ ok: true, error: null, hash: "abc1234", message: "Committed" })),
  gitPush: vi.fn(async () => ({ ok: true, error: null, hash: null, message: "Pushed" })),
}));
vi.mock("../lib/api", () => ({ api }));

import { GitMenu, SYNC_INTERVAL_EVENT } from "./GitMenu";

const MIN = 60_000;
const repo = (files: GitStatus["files"], ahead = 0): GitStatus => ({
  is_repo: true,
  has_remote: true,
  remote_url: null,
  branch: "main",
  ahead,
  files,
  total_added: 0,
  total_deleted: 0,
});
const change = { status: " M", path: "backlog.md", added: 1, deleted: 0, binary: false };

async function mount() {
  const onBeforeCommit = vi.fn(async () => {});
  render(<GitMenu onBeforeCommit={onBeforeCommit} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return onBeforeCommit;
}
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  state.interval = 0;
  state.status = repo([change]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GitMenu timed sync", () => {
  it("does nothing while the interval is off", async () => {
    await mount();
    await wait(90 * MIN);
    expect(api.gitCommit).not.toHaveBeenCalled();
    expect(api.gitPush).not.toHaveBeenCalled();
  });

  it("flushes, then commits and pushes once the interval has passed", async () => {
    state.interval = 5;
    const flush = await mount();
    await wait(4 * MIN);
    expect(api.gitCommit).not.toHaveBeenCalled();
    await wait(2 * MIN);
    expect(flush).toHaveBeenCalledOnce();
    expect(api.gitCommit).toHaveBeenCalledOnce();
    expect(api.gitCommit).toHaveBeenCalledWith("Update backlog.md", true);
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(api.gitCommit.mock.invocationCallOrder[0]);
  });

  // The regression this guards: Settings lives in its own window, so the old
  // same-window DOM event never reached the timer.
  it("picks up a new interval from the Settings window without a restart", async () => {
    await mount();
    expect(listeners[SYNC_INTERVAL_EVENT]).toBeTypeOf("function");
    state.interval = 5;
    await act(async () => {
      listeners[SYNC_INTERVAL_EVENT]();
      await vi.advanceTimersByTimeAsync(0);
    });
    await wait(6 * MIN);
    expect(api.gitCommit).toHaveBeenCalledOnce();
  });

  it("only pushes when nothing changed but commits are waiting", async () => {
    state.interval = 5;
    state.status = repo([], 2);
    await mount();
    await wait(6 * MIN);
    expect(api.gitCommit).not.toHaveBeenCalled();
    expect(api.gitPush).toHaveBeenCalledOnce();
  });

  it("skips a clean folder, and a folder that isn't a repository", async () => {
    state.interval = 5;
    state.status = repo([]);
    await mount();
    await wait(6 * MIN);
    state.status = { ...repo([change]), is_repo: false };
    await wait(6 * MIN);
    expect(api.gitCommit).not.toHaveBeenCalled();
    expect(api.gitPush).not.toHaveBeenCalled();
  });
});
