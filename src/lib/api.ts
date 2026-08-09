// Thin typed wrappers around the Rust commands defined in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";

export interface NoteMeta {
  name: string;
  modified: number;
}

export interface NoteHit {
  name: string;
  modified: number;
  in_name: boolean; // matched by filename
  snippet: string | null; // matching content line
}

export interface Session {
  open: string[];
  active: string | null;
  theme: string | null;
}

export interface SettingsInfo {
  notes_dir: string;
  autostart: boolean;
  shortcut: string;
  default_shortcut: string;
  git_auto_sync: boolean;
}

export interface GitFileChange {
  status: string; // two-char porcelain code, e.g. " M", "A ", "??"
  path: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface GitStatus {
  is_repo: boolean;
  has_remote: boolean;
  remote_url: string | null; // push URL of origin, when a remote exists
  branch: string | null;
  ahead: number; // -1 when no upstream is configured
  files: GitFileChange[];
  total_added: number;
  total_deleted: number;
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  rel_date: string;
  unpushed: boolean;
}

export interface CommitResult {
  ok: boolean;
  error: string | null;
  hash: string | null;
  message: string;
}

export const api = {
  notesDirPath: () => invoke<string>("notes_dir_path"),
  homeDirPath: () => invoke<string>("home_dir_path"),
  listNotes: () => invoke<NoteMeta[]>("list_notes"),
  searchNotes: (query: string) => invoke<NoteHit[]>("search_notes", { query }),
  readNote: (name: string) => invoke<string>("read_note", { name }),
  writeNote: (name: string, content: string) =>
    invoke<void>("write_note", { name, content }),
  createNote: (ext?: string) => invoke<string>("create_note", { ext }),
  renameNote: (from: string, to: string) =>
    invoke<void>("rename_note", { from, to }),
  loadSession: () => invoke<Session>("load_session"),
  saveSession: (session: Session) => invoke<void>("save_session", { session }),

  getSettings: () => invoke<SettingsInfo>("get_settings"),
  setShortcut: (accelerator: string) =>
    invoke<void>("set_shortcut", { accelerator }),
  setAutostart: (enabled: boolean) =>
    invoke<void>("set_autostart", { enabled }),
  setGitAutoSync: (enabled: boolean) =>
    invoke<void>("set_git_auto_sync", { enabled }),
  gitStatus: () => invoke<GitStatus>("git_status"),
  gitLog: (limit?: number) => invoke<GitLogEntry[]>("git_log", { limit }),
  gitCommit: (message: string, push: boolean) =>
    invoke<CommitResult>("git_commit", { message, push }),
  gitPush: () => invoke<CommitResult>("git_push"),
  pickNotesDir: () => invoke<string | null>("pick_notes_dir"),
  setNotesDir: (path: string, moveExisting: boolean) =>
    invoke<string>("set_notes_dir", { path, moveExisting }),
  quit: () => invoke<void>("quit"),
};
