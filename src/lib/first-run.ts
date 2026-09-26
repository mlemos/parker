// The words of the first run on a Mac (Onda 5), and of Settings where it
// tells how to reach the same folder from the iPhone. Pure: they depend only
// on what Rust found about a folder (folder.rs) and on iCloud's state, so
// every sentence is tested against every situation the prototype drew.

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

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Screen 1's one-line summary of what's in the folder. */
export function contentsLine(f: FolderInfo): string {
  if (!f.exists) return "Doesn't exist yet — created when you continue";
  if (!f.notes && !f.other) return "Empty";
  return plural(f.notes, "note") + (f.other ? ` · ${plural(f.other, "other file")}` : "");
}

/** Screen 2's longer version, which says what Parker will do with it. */
export function stateLine(f: FolderInfo): string {
  if (!f.exists) return "Doesn't exist yet — Parker creates it when you press Continue.";
  if (!f.notes && !f.other) return "Exists and is empty — Parker adds a Welcome note.";
  if (!f.notes) return `Exists, with ${plural(f.other, "file")} but no notes yet. Parker leaves those files alone.`;
  return `Exists, with ${plural(f.notes, "note")}${f.other ? ` and ${plural(f.other, "other file")} Parker leaves alone` : ""}.`;
}

export type Tone = "ok" | "warn" | "unknown";

/** Whether the folder syncs, as far as the Mac can tell — "stays on this Mac"
 *  only when that is a fact (Documents with Desktop & Documents off). */
export function syncLine(f: FolderInfo, icloud: ICloudState): { tone: Tone; text: string } {
  const s = f.sync.service;
  if (s === "icloud") {
    if (!icloud.drive) return { tone: "warn", text: "In iCloud Drive, but iCloud Drive is off on this Mac." };
    return { tone: "ok", text: `Syncs with iCloud Drive${f.path.includes("/Documents/") && icloud.documents ? " — Desktop & Documents is on." : "."}` };
  }
  if (s === "local") {
    return {
      tone: "warn",
      text: icloud.drive
        ? "Stays on this Mac — your Documents folder isn't in iCloud."
        : "Stays on this Mac — iCloud Drive is off.",
    };
  }
  if (s === "unknown") return { tone: "unknown", text: "Not in iCloud Drive. If it syncs some other way, see Other ways to sync below." };
  return { tone: "unknown", text: `Not in iCloud Drive — this folder is in ${f.sync.label}. See Other ways to sync below.` };
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

/** What to do on the iPhone to open this same folder. `suggested` is whether
 *  it is Documents › Parker, the one folder the iPhone looks for by itself. */
export function iphoneLine(f: FolderInfo, icloud: ICloudState, suggested: boolean): string {
  const s = f.sync.service;
  if (suggested && s === "icloud" && icloud.drive)
    return "Install Parker for iPhone and tap Continue with iCloud Drive — it finds this folder by itself.";
  if (suggested) return "Your iPhone can't reach it yet. Turn on Desktop & Documents and it can — then, on the iPhone, Continue with iCloud Drive.";
  if (s === "icloud") return `On the iPhone: Parker › Use another folder › ${filesAppPath(f)}.`;
  if (s === "google-drive" || s === "dropbox" || s === "onedrive" || s === "box")
    return `On the iPhone: Parker › Use another folder › ${f.display}. The ${f.sync.label} app must be installed.`;
  if (s === "local") return "Your iPhone can't reach it while Documents stays on this Mac.";
  return "If this folder stays on this Mac, your iPhone can't open it. To use Parker there, keep your notes in iCloud Drive or another synced folder.";
}

/** Settings' line under the notes folder: how to open the same folder on the
 *  iPhone — only when the iPhone can reach it at all (in iCloud Drive, or in
 *  a service with an iPhone app); otherwise nothing. */
export function settingsIphoneLine(f: FolderInfo, icloud: ICloudState): string | null {
  const reachable = (f.sync.service === "icloud" && icloud.drive) || ["google-drive", "dropbox", "onedrive", "box"].includes(f.sync.service);
  if (!reachable) return null;
  const suggested = /\/Documents\/Parker( \(Dev\))?$/.test(f.path) && f.sync.service === "icloud";
  return iphoneLine(f, icloud, suggested);
}

/** The git row. Git is history and backup, not sync. */
export function gitLine(f: FolderInfo): { tone: Tone | "none"; text: string; note: string } {
  if (f.git)
    return {
      tone: "ok",
      text: f.git_remote ? `A git repository (remote: ${f.git_remote}).` : "A git repository, with no remote.",
      note:
        "Parker can commit and push your changes — on a timer, or when you quit. Turn it on in Settings › Backup & Git." +
        // iCloud and git together: iCloud may copy or evict files inside .git.
        (f.sync.service === "icloud" ? " In iCloud, keep an eye on it: iCloud can duplicate files inside .git, or take them off this Mac." : ""),
    };
  return {
    tone: "none",
    text: `Not a git repository${f.exists ? "" : " (the folder doesn't exist yet)"}.`,
    note: "Optional. If you make it one later, Parker can commit and push it — Settings › Backup & Git.",
  };
}

/** Screen 1's line about iCloud. */
export function icloudLine(f: FolderInfo, icloud: ICloudState): { tone: Tone; text: string } {
  if (f.sync.service === "icloud" && icloud.drive) return { tone: "ok", text: "Syncs with iCloud Drive" };
  return {
    tone: f.sync.service === "local" ? "warn" : "unknown",
    text: icloud.drive ? "Not in iCloud — Documents stays on this Mac" : "Not in iCloud — iCloud Drive is off",
  };
}

/** Where the welcome goes after "Look in Documents": found notes, a fresh
 *  start, or — macOS said no — choose a folder instead. */
export function afterLook(f: FolderInfo): "found" | "create" | "denied" {
  if (!f.readable) return "denied";
  return f.exists && (f.notes > 0 || f.other > 0) ? "found" : "create";
}
