import { describe, expect, it } from "vitest";
import {
  afterLook,
  contentsLine,
  filesAppPath,
  gitLine,
  icloudLine,
  iphoneLine,
  recommendDocuments,
  settingsIphoneLine,
  stateLine,
  syncLine,
} from "./first-run";
import type { FolderInfo, ICloudState } from "./first-run";

const folder = (over: Partial<FolderInfo> = {}): FolderInfo => ({
  path: "/home/me/Documents/Parker",
  display: "Documents › Parker",
  exists: true,
  readable: true,
  notes: 42,
  other: 0,
  git: false,
  git_remote: null,
  sync: { service: "icloud", label: "iCloud Drive" },
  ...over,
});
const ON: ICloudState = { drive: true, documents: true };
const DOCS_OFF: ICloudState = { drive: true, documents: false };
const DRIVE_OFF: ICloudState = { drive: false, documents: false };
const LOCAL = { service: "local", label: "this Mac" };

describe("what a folder holds", () => {
  it("says whether it exists, and counts notes and other files", () => {
    expect(contentsLine(folder({ exists: false, notes: 0 }))).toMatch(/Doesn't exist yet/);
    expect(contentsLine(folder({ notes: 0 }))).toBe("Empty");
    expect(contentsLine(folder({ notes: 1, other: 2 }))).toBe("1 note · 2 other files");
    expect(stateLine(folder({ notes: 0 }))).toMatch(/Welcome note/);
    expect(stateLine(folder({ notes: 0, other: 3 }))).toMatch(/3 files but no notes yet/);
    expect(stateLine(folder({ notes: 42, other: 1 }))).toBe("Exists, with 42 notes and 1 other file Parker leaves alone.");
  });
});

describe("where it syncs", () => {
  it("says iCloud when it is, and 'stays on this Mac' only as a fact", () => {
    expect(syncLine(folder(), ON)).toEqual({ tone: "ok", text: "Syncs with iCloud Drive — Desktop & Documents is on." });
    expect(syncLine(folder({ sync: LOCAL }), DOCS_OFF).text).toBe("Stays on this Mac — your Documents folder isn't in iCloud.");
    expect(syncLine(folder({ sync: LOCAL }), DRIVE_OFF).text).toBe("Stays on this Mac — iCloud Drive is off.");
    expect(syncLine(folder({ path: "/home/me/Projects/n", sync: { service: "unknown", label: "" } }), ON).tone).toBe("unknown");
    expect(syncLine(folder({ sync: { service: "google-drive", label: "Google Drive" } }), ON).text).toMatch(/in Google Drive/);
  });

  it("recommends Desktop & Documents only for a Documents folder that stays here", () => {
    expect(recommendDocuments(folder({ sync: LOCAL }))).toBe(true);
    expect(recommendDocuments(folder())).toBe(false);
    expect(recommendDocuments(folder({ path: "/home/me/Notes", sync: LOCAL }))).toBe(false);
  });

  it("gives Screen 1 its iCloud line", () => {
    expect(icloudLine(folder(), ON)).toEqual({ tone: "ok", text: "Syncs with iCloud Drive" });
    expect(icloudLine(folder({ sync: LOCAL }), DOCS_OFF)).toEqual({ tone: "warn", text: "Not in iCloud — Documents stays on this Mac" });
    expect(icloudLine(folder({ sync: LOCAL }), DRIVE_OFF).text).toBe("Not in iCloud — iCloud Drive is off");
  });
});

describe("what to do on the iPhone", () => {
  it("finds Documents › Parker by itself when it is in iCloud", () => {
    expect(iphoneLine(folder(), ON, true)).toMatch(/Continue with iCloud Drive — it finds this folder by itself/);
    expect(iphoneLine(folder({ sync: LOCAL }), DOCS_OFF, true)).toMatch(/can't reach it yet/);
  });

  it("points any other folder at Use another folder, with the path as Files shows it", () => {
    const docs = folder({ path: "/home/me/Documents/Notes", display: "Documents › Notes" });
    expect(filesAppPath(docs)).toBe("iCloud Drive › Documents › Notes");
    expect(iphoneLine(docs, ON, false)).toBe("On the iPhone: Parker › Use another folder › iCloud Drive › Documents › Notes.");
    const drive = folder({ display: "iCloud Drive › Notes" });
    expect(filesAppPath(drive)).toBe("iCloud Drive › Notes");
    const g = folder({ display: "Google Drive › My Drive › Notes", sync: { service: "google-drive", label: "Google Drive" } });
    expect(iphoneLine(g, ON, false)).toMatch(/Google Drive › My Drive › Notes\. The Google Drive app must be installed\./);
    expect(iphoneLine(folder({ path: "/home/me/Notes", sync: { service: "unknown", label: "" } }), ON, false)).toMatch(/can't open it/);
  });
});

describe("git", () => {
  it("names the remote, and warns about git inside iCloud", () => {
    const g = gitLine(folder({ git: true, git_remote: "github.com/me/notes" }));
    expect(g.text).toBe("A git repository (remote: github.com/me/notes).");
    expect(g.note).toMatch(/iCloud can duplicate files inside \.git/);
    expect(gitLine(folder({ git: true, sync: LOCAL })).note).not.toMatch(/iCloud/);
    expect(gitLine(folder({ exists: false })).text).toBe("Not a git repository (the folder doesn't exist yet).");
  });
});

describe("after the look", () => {
  it("goes to found, create or denied", () => {
    expect(afterLook(folder())).toBe("found");
    expect(afterLook(folder({ notes: 0 }))).toBe("create");
    expect(afterLook(folder({ exists: false, notes: 0 }))).toBe("create");
    expect(afterLook(folder({ readable: false }))).toBe("denied");
  });
});

describe("Settings: the same folder on the iPhone", () => {
  it("says how, only when the iPhone can reach the folder", () => {
    expect(settingsIphoneLine(folder(), ON)).toMatch(/Continue with iCloud Drive — it finds this folder by itself/);
    expect(settingsIphoneLine(folder({ path: "/home/me/Documents/Parker (Dev)" }), ON)).toMatch(/finds this folder by itself/);
    expect(settingsIphoneLine(folder({ path: "/home/me/Documents/Work", display: "Documents › Work" }), ON)).toBe(
      "On the iPhone: Parker › Use another folder › iCloud Drive › Documents › Work."
    );
    const g = folder({ display: "Google Drive › Notes", sync: { service: "google-drive", label: "Google Drive" } });
    expect(settingsIphoneLine(g, ON)).toMatch(/The Google Drive app must be installed/);
    expect(settingsIphoneLine(folder({ sync: LOCAL }), DOCS_OFF)).toBeNull();
    expect(settingsIphoneLine(folder({ sync: { service: "unknown", label: "" } }), ON)).toBeNull();
    expect(settingsIphoneLine(folder(), DRIVE_OFF)).toBeNull();
  });
});
