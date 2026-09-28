// The words of the first run on a Mac (Onda 5), and of Settings where it
// tells how to reach the same folder from the iPhone. The words themselves are
// in shared/first-run-copy.json, which the iPhone reads too (ParkerCore
// FirstRunCopy), so the two apps say the same thing; this picks the right one
// for what Rust found about a folder (folder.rs) and for iCloud's state.
// shared/fixtures/first-run-lines.json holds the sentences for every situation,
// checked here and on the iPhone.
import copyFile from "../../shared/first-run-copy.json";

export interface SyncInfo {
  /** "icloud" | "google-drive" | "dropbox" | "onedrive" | "box" | "cloud" | "local" | "unknown" */
  service: string;
  label: string;
}

export interface FolderInfo {
  path: string;
  /** As the Finder shows it: "Documents › Parker". */
  display: string;
  exists: boolean;
  /** False when macOS said no to looking in Documents. */
  readable: boolean;
  notes: number;
  other: number;
  git: boolean;
  git_remote: string | null;
  sync: SyncInfo;
}

export interface ICloudState {
  drive: boolean;
  documents: boolean;
}

const STRINGS: Record<string, string> = copyFile.strings;

export type Platform = "mac" | "iphone";

/** A sentence of the first run in one app's version (the Mac's unless said),
 *  with its {placeholders} filled. A missing key is a bug, and says so. */
export function copy(key: string, vars: Record<string, string | number> = {}, platform: Platform = "mac"): string {
  const s = STRINGS[`${key}@${platform}`] ?? STRINGS[key];
  if (s === undefined) throw new Error(`first-run copy: no "${key}"`);
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export const count = (n: number, one: string) => copy(n === 1 ? `unit.${one}` : `unit.${one}s`, { n });

/** Screen 1's one-line summary of what's in the folder. */
export function contentsLine(f: FolderInfo): string {
  if (!f.exists) return copy("line.contents.new");
  if (!f.notes && !f.other) return copy("line.contents.empty");
  if (!f.other) return copy("line.contents.notes", { notes: count(f.notes, "note") });
  return copy("line.contents.notesOther", { notes: count(f.notes, "note"), other: count(f.other, "otherFile") });
}

/** The setup screen's version, which says what Parker will do with it. */
export function stateLine(f: FolderInfo): string {
  if (!f.exists) return copy("line.state.new");
  if (!f.notes && !f.other) return copy("line.state.empty");
  if (!f.notes) return copy("line.state.onlyOther", { other: count(f.other, "file") });
  if (!f.other) return copy("line.state.notes", { notes: count(f.notes, "note") });
  return copy("line.state.notesOther", { notes: count(f.notes, "note"), other: count(f.other, "otherFile") });
}

export type Tone = "ok" | "warn" | "unknown" | "none";

/** Whether the folder syncs, as far as the Mac can tell — "stays on this Mac"
 *  only when that is a fact (Documents with Desktop & Documents off). */
export function syncLine(f: FolderInfo, icloud: ICloudState): { tone: Tone; text: string } {
  const s = f.sync.service;
  if (s === "icloud") return icloud.drive ? { tone: "ok", text: copy("line.sync.icloud") } : { tone: "warn", text: copy("line.sync.icloudDriveOff") };
  if (s === "local") return { tone: "warn", text: copy(icloud.drive ? "line.sync.here" : "line.sync.hereDriveOff") };
  if (s === "unknown") return { tone: "unknown", text: copy("line.sync.unknown") };
  return { tone: "ok", text: copy("line.sync.service", { service: f.sync.label }) };
}

/** Whether to recommend turning on Desktop & Documents: only for a folder in
 *  Documents that stays on this Mac. It is a recommendation, never forced. */
export function recommendDocuments(f: FolderInfo): boolean {
  return f.sync.service === "local" && /\/Documents(\/|$)/.test(f.path);
}

/** The folder as the iPhone's Files app shows it: a Documents folder in iCloud
 *  is under iCloud Drive there. */
export function filesAppPath(f: FolderInfo): string {
  return f.sync.service === "icloud" && !f.display.startsWith("iCloud Drive") ? `iCloud Drive › ${f.display}` : f.display;
}

const SERVICES = ["google-drive", "dropbox", "onedrive", "box"];

/** What to do on the iPhone to open this same folder. `suggested` is whether
 *  it is Documents › Parker, the one folder the iPhone looks for by itself. */
export function iphoneLine(f: FolderInfo, icloud: ICloudState, suggested: boolean): string {
  const s = f.sync.service;
  if (suggested) return copy(s === "icloud" && icloud.drive ? "line.other.suggested" : "line.other.suggestedOff");
  if (s === "icloud") return copy("line.other.icloud", { folder: filesAppPath(f) });
  if (SERVICES.includes(s)) return copy("line.other.service", { service: f.sync.label, folder: f.display });
  if (s === "local") return copy("line.other.here");
  return copy("line.other.unknown");
}

/** Settings' line under the notes folder: how to open the same folder on the
 *  iPhone — only when the iPhone can reach it at all (in iCloud Drive, or in
 *  a service with an iPhone app); otherwise nothing. */
export function settingsIphoneLine(f: FolderInfo, icloud: ICloudState): string | null {
  const reachable = (f.sync.service === "icloud" && icloud.drive) || SERVICES.includes(f.sync.service);
  if (!reachable) return null;
  const suggested = /\/Documents\/Parker( \(Dev\))?$/.test(f.path) && f.sync.service === "icloud";
  return iphoneLine(f, icloud, suggested);
}

/** The git line: short on the found screen, with a note on the setup screen.
 *  Git is history and backup, not sync. */
export function gitLine(f: FolderInfo): { tone: Tone; text: string; note: string } {
  if (f.git)
    return {
      tone: "ok",
      text: f.git_remote ? copy("line.git.remote", { remote: f.git_remote }) : copy("line.git.noRemote"),
      // iCloud and git together: iCloud may copy or evict files inside .git.
      note: copy(f.sync.service === "icloud" ? "line.git.noteICloud" : "line.git.note"),
    };
  return { tone: "none", text: copy(f.exists ? "line.git.none" : "line.git.new"), note: copy("line.git.noneNote") };
}

/** Where the welcome goes after "Look in Documents": found notes, a fresh
 *  start, or — macOS said no — choose a folder instead. */
export function afterLook(f: FolderInfo): "found" | "create" | "denied" {
  if (!f.readable) return "denied";
  return f.exists && (f.notes > 0 || f.other > 0) ? "found" : "create";
}
