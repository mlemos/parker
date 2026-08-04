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

export const api = {
  notesDirPath: () => invoke<string>("notes_dir_path"),
  listNotes: () => invoke<NoteMeta[]>("list_notes"),
  readNote: (name: string) => invoke<string>("read_note", { name }),
  writeNote: (name: string, content: string) =>
    invoke<void>("write_note", { name, content }),
  createNote: (ext?: string) => invoke<string>("create_note", { ext }),
  renameNote: (from: string, to: string) =>
    invoke<void>("rename_note", { from, to }),
  loadSession: () => invoke<Session>("load_session"),
  saveSession: (session: Session) => invoke<void>("save_session", { session }),
};
