// What the update UI shows (Onda 6). Rust checks, downloads and installs
// (src-tauri/src/updates.rs); this is the part of it the windows draw.

export interface UpdateInfo {
  version: string;
  current: string;
  /** Release notes, Markdown. */
  notes: string;
}

export interface UpdateState {
  /** Updates can happen in this build (not in Parker Dev). */
  enabled: boolean;
  current: string;
  available: UpdateInfo | null;
  /** Why this copy can't update itself (run from the DMG), if it can't. */
  blocked: string | null;
}

/** The Update & Restart button while it works. `total` is null when the
 *  server didn't say how big the download is. */
export function progressLabel(got: number, total: number | null): string {
  if (!total) return got > 0 ? `Downloading… ${(got / 1e6).toFixed(1)} MB` : "Downloading…";
  const pct = Math.min(100, Math.floor((got / total) * 100));
  return pct >= 100 ? "Installing…" : `Downloading… ${pct}%`;
}

/** What Check for Updates… found, in a sentence for the sheet or Settings. */
export function checkResult(current: string, found: UpdateInfo | null, error?: string): string {
  if (error) return `Couldn't check for updates: ${error}`;
  return found ? `Parker ${found.version} is available.` : `You're up to date — Parker ${current}.`;
}
