// Thin typed wrappers around the Rust commands defined in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";

export interface NoteMeta {
  name: string;
  modified: number;
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
}

export const api = {
  notesDirPath: () => invoke<string>("notes_dir_path"),
  homeDirPath: () => invoke<string>("home_dir_path"),
  listNotes: () => invoke<NoteMeta[]>("list_notes"),
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
  pickNotesDir: () => invoke<string | null>("pick_notes_dir"),
  setNotesDir: (path: string, moveExisting: boolean) =>
    invoke<string>("set_notes_dir", { path, moveExisting }),
  quit: () => invoke<void>("quit"),
};
