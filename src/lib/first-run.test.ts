import { describe, expect, it } from "vitest";
import copyFile from "../../shared/first-run-copy.json";
import linesFixture from "../../shared/fixtures/first-run-lines.json";
import {
  afterLook,
  contentsLine,
  copy,
  filesAppPath,
  gitLine,
  iphoneLine,
  recommendDocuments,
  settingsIphoneLine,
  stateLine,
  syncLine,
} from "./first-run";
import type { FolderInfo, ICloudState } from "./first-run";
import { phoneFixture } from "./first-run-iphone";
import firstRunSource from "../components/FirstRun.tsx?raw";
import onboardingSwift from "../../ios/Parker/Sources/OnboardingView.swift?raw";
import firstRunSwift from "../../ios/ParkerCore/Sources/ParkerCore/FirstRun.swift?raw";

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

describe("the words, from one file", () => {
  const strings = copyFile.strings as Record<string, string>;
  const known = (key: string, platform: "mac" | "iphone") => `${key}@${platform}` in strings || key in strings;

  it("picks the app's own version of a key, and fills its placeholders", () => {
    expect(copy("welcome.primary")).toBe("Look in Documents");
    expect(copy("welcome.primary", {}, "iphone")).toBe("Continue with iCloud Drive");
    expect(copy("found.lead", { contents: "42 notes", folder: "Documents › Parker" })).toBe("42 notes in **Documents › Parker**.");
    expect(() => copy("no.such.key")).toThrow(/no "no.such.key"/);
  });

  // Every t("…") / copy("…") in the screens names a key the file has, for
  // that app — so a word can't go missing on one side only.
  it("has every key the Mac's and the iPhone's screens ask for", () => {
    const keys = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m[1]);
    const mac = keys(firstRunSource, /\bt\("([\w.]+)"/g);
    const iphone = [...keys(onboardingSwift, /\bt\("([\w.]+)"/g), ...keys(firstRunSwift, /\bt\("([\w.]+)"/g)];
    expect(mac.length).toBeGreaterThan(20);
    expect(iphone.length).toBeGreaterThan(20);
    expect(mac.filter((k) => !known(k, "mac"))).toEqual([]);
    expect(iphone.filter((k) => !known(k, "iphone"))).toEqual([]);
  });

  it("writes plainly: no dashes as pauses, no sentence longer than two lines", () => {
    for (const [key, s] of Object.entries(strings)) {
      expect(s, key).not.toMatch(/ — /);
      expect(s.replace(/\*\*|\[|\]\([^)]*\)/g, "").length, key).toBeLessThanOrEqual(260);
    }
  });

  it("shared/fixtures/first-run-lines.json is fresh (run: node scripts/export-first-run-lines.mjs)", () => {
    expect(linesFixture).toEqual(JSON.parse(JSON.stringify(phoneFixture())));
  });
});

describe("what a folder holds", () => {
  it("says whether it exists, and counts notes and other files", () => {
    expect(contentsLine(folder({ exists: false, notes: 0 }))).toBe("Not created yet");
    expect(contentsLine(folder({ notes: 0 }))).toBe("Empty");
    expect(contentsLine(folder({ notes: 1, other: 2 }))).toBe("1 note · 2 other files");
    expect(stateLine(folder({ exists: false, notes: 0 }))).toBe("New. I'll create it when you continue.");
    expect(stateLine(folder({ notes: 0 }))).toBe("Empty. I'll add a Welcome note.");
    expect(stateLine(folder({ notes: 0, other: 3 }))).toBe("3 files, no notes yet. I leave those files alone.");
    expect(stateLine(folder({ notes: 42, other: 1 }))).toBe("42 notes, plus 1 other file I leave alone.");
    expect(stateLine(folder())).toBe("42 notes.");
  });
});

describe("where it syncs", () => {
  it("says iCloud when it is, and 'stays on this Mac' only as a fact", () => {
    expect(syncLine(folder(), ON)).toEqual({ tone: "ok", text: "Syncs with iCloud Drive." });
    expect(syncLine(folder(), DRIVE_OFF).tone).toBe("warn");
    expect(syncLine(folder({ sync: LOCAL }), DOCS_OFF)).toEqual({ tone: "warn", text: "Stays on this Mac. Documents isn't in iCloud." });
    expect(syncLine(folder({ sync: LOCAL }), DRIVE_OFF).text).toBe("Stays on this Mac. iCloud Drive is off.");
    expect(syncLine(folder({ path: "/home/me/Projects/n", sync: { service: "unknown", label: "" } }), ON).tone).toBe("unknown");
    expect(syncLine(folder({ sync: { service: "google-drive", label: "Google Drive" } }), ON)).toEqual({
      tone: "ok",
      text: "Syncs with Google Drive, not iCloud Drive.",
    });
  });

  it("recommends Desktop & Documents only for a Documents folder that stays here", () => {
    expect(recommendDocuments(folder({ sync: LOCAL }))).toBe(true);
    expect(recommendDocuments(folder())).toBe(false);
    expect(recommendDocuments(folder({ path: "/home/me/Notes", sync: LOCAL }))).toBe(false);
  });
});

describe("what to do on the iPhone", () => {
  it("finds Documents › Parker by itself when it is in iCloud", () => {
    expect(iphoneLine(folder(), ON, true)).toBe("Install Parker for iPhone and tap Continue with iCloud Drive. It finds this folder by itself.");
    expect(iphoneLine(folder({ sync: LOCAL }), DOCS_OFF, true)).toMatch(/can't reach it yet/);
  });

  it("points any other folder at Choose another folder, with the path as Files shows it", () => {
    const docs = folder({ path: "/home/me/Documents/Notes", display: "Documents › Notes" });
    expect(filesAppPath(docs)).toBe("iCloud Drive › Documents › Notes");
    expect(iphoneLine(docs, ON, false)).toBe("In Parker for iPhone, tap Choose another folder and pick iCloud Drive › Documents › Notes.");
    expect(filesAppPath(folder({ display: "iCloud Drive › Notes" }))).toBe("iCloud Drive › Notes");
    const g = folder({ display: "Google Drive › My Drive › Notes", sync: { service: "google-drive", label: "Google Drive" } });
    expect(iphoneLine(g, ON, false)).toBe("Install the Google Drive app, then in Parker for iPhone tap Choose another folder and pick Google Drive › My Drive › Notes.");
    expect(iphoneLine(folder({ path: "/home/me/Notes", sync: { service: "unknown", label: "" } }), ON, false)).toMatch(/can't open it/);
  });

  // 05/10 screen check: a folder in iCloud while iCloud Drive is off on this
  // Mac isn't syncing — sending the iPhone to it would show stale notes.
  it("says to turn iCloud Drive on first when it is off on this Mac", () => {
    const n = folder({ display: "iCloud Drive › Notes" });
    expect(iphoneLine(n, { drive: false, documents: false }, false)).toBe(
      "Turn on iCloud Drive on this Mac first, or your iPhone won't see your notes. Then, in Parker for iPhone, tap Choose another folder and pick iCloud Drive › Notes."
    );
  });

  // A service Parker has no name for still syncs: not "stays on this Mac".
  it("gives a service it doesn't know by name a way in, in Settings too", () => {
    const p = folder({ path: "/home/me/Library/CloudStorage/pCloud/Notes", display: "pCloud › Notes", sync: { service: "cloud", label: "pCloud" } });
    const line = "If pCloud has an iPhone app, install it, then in Parker for iPhone tap Choose another folder and pick pCloud › Notes.";
    expect(iphoneLine(p, ON, false)).toBe(line);
    expect(settingsIphoneLine(p, ON)).toBe(line);
  });
});

describe("git", () => {
  it("names the remote, and warns about git inside iCloud", () => {
    const g = gitLine(folder({ git: true, git_remote: "github.com/me/notes" }));
    expect(g.text).toBe("Git repository · github.com/me/notes");
    expect(g.note).toMatch(/iCloud can duplicate files inside \.git/);
    expect(gitLine(folder({ git: true, sync: LOCAL })).note).not.toMatch(/iCloud/);
    expect(gitLine(folder({ git: true })).text).toBe("Git repository, no remote");
    expect(gitLine(folder()).text).toBe("Not a git repository");
    expect(gitLine(folder({ exists: false })).text).toBe("None yet");
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
    expect(settingsIphoneLine(folder(), ON)).toMatch(/It finds this folder by itself/);
    expect(settingsIphoneLine(folder({ path: "/home/me/Documents/Parker (Dev)" }), ON)).toMatch(/finds this folder by itself/);
    expect(settingsIphoneLine(folder({ path: "/home/me/Documents/Work", display: "Documents › Work" }), ON)).toBe(
      "In Parker for iPhone, tap Choose another folder and pick iCloud Drive › Documents › Work."
    );
    const g = folder({ display: "Google Drive › Notes", sync: { service: "google-drive", label: "Google Drive" } });
    expect(settingsIphoneLine(g, ON)).toMatch(/Install the Google Drive app/);
    expect(settingsIphoneLine(folder({ sync: LOCAL }), DOCS_OFF)).toBeNull();
    expect(settingsIphoneLine(folder({ sync: { service: "unknown", label: "" } }), ON)).toBeNull();
    expect(settingsIphoneLine(folder(), DRIVE_OFF)).toBeNull();
  });
});
