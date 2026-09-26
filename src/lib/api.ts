// Thin typed wrappers around the Rust commands defined in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";

export interface NoteMeta {
  name: string;
  modified: number;
  size: number; // bytes
}

export interface NoteHit {
  name: string;
  modified: number;
  size: number; // bytes
  in_name: boolean; // matched by filename
  snippet: string | null; // matching content line
}

export interface Session {
  open: string[];
  active: string | null;
  theme: string | null;
  /** The theme's editor background, for the windows Rust opens before their
   *  page paints (Settings, Help). */
  theme_bg?: string | null;
  layout?: unknown; // serialized split layout tree (frontend-owned schema)
  focused?: string | null; // focused group id within the layout
  /** Note windows — Rust's part of the session; the frontend never sends it. */
  windows?: unknown[];
}

export interface SettingsInfo {
  notes_dir: string;
  autostart: boolean;
  shortcut: string;
  default_shortcut: string;
  git_auto_sync: boolean;
  /** Minutes between timed commit+push runs; 0 = off. */
  git_sync_interval: number;
  /** Webview zoom factor; 1 = 100%. */
  zoom: number;
  /** Editor toggles — Parker's settings, not the webview's storage. */
  editor_gutter: boolean;
  editor_wrap: boolean;
  editor_ligatures: boolean;
  /** Measure in columns; 0 = the window's width. */
  editor_width: number;
  /** The side-by-side preview follows the editor. */
  preview_sync: boolean;
  /** "none" | "local" | "all" — Settings › Privacy & Security. */
  preview_images: string;
}

/** The Parker skill for Claude Code, and whether the notes folder has a
 *  README for agents. See src-tauri/src/agents.rs. */
export interface AgentsInfo {
  claude_code: "missing" | "current" | "different";
  claude_code_dir: string;
  readme: boolean;
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
  /** A new empty note — inside `folder` ("cos/desks") when given. */
  createNote: (ext?: string, folder?: string) =>
    invoke<string>("create_note", { ext, folder: folder || null }),
  /** Every folder in the notes folder, any depth, "cos/desks" style — the
   *  empty ones too. */
  listFolders: () => invoke<string[]>("list_folders"),
  renameNote: (from: string, to: string) =>
    invoke<void>("rename_note", { from, to }),
  deleteNote: (name: string) => invoke<void>("delete_note", { name }),
  loadSession: () => invoke<Session>("load_session"),
  /** Append one JSON line to changes.jsonl — the reload/conflict diary. */
  logChange: (line: string) => invoke<void>("log_change", { line }),
  saveSession: (session: Session) => invoke<void>("save_session", { session }),

  getSettings: () => invoke<SettingsInfo>("get_settings"),
  setShortcut: (accelerator: string) =>
    invoke<void>("set_shortcut", { accelerator }),
  setAutostart: (enabled: boolean) =>
    invoke<void>("set_autostart", { enabled }),
  setGitAutoSync: (enabled: boolean) =>
    invoke<void>("set_git_auto_sync", { enabled }),
  setGitSyncInterval: (minutes: number) =>
    invoke<void>("set_git_sync_interval", { minutes }),
  /** Zoom the whole interface. Returns the value actually applied (clamped). */
  setZoom: (scale: number) => invoke<number>("set_zoom", { scale }),
  /** Persist the three editor toggles together. */
  setEditorPrefs: (
    gutter: boolean,
    wrap: boolean,
    ligatures: boolean,
    width: number
  ) => invoke<void>("set_editor_prefs", { gutter, wrap, ligatures, width }),
  setPreviewSync: (enabled: boolean) =>
    invoke<void>("set_preview_sync", { enabled }),
  /** Open (or focus) the Settings window. */
  /** Opens (or brings back) Settings, on `section` when given. */
  openSettings: (section?: string) => invoke<void>("open_settings", { section: section ?? null }),
  setPreviewImages: (mode: string) => invoke<void>("set_preview_images", { mode }),
  /** The theme in force, for the windows Rust opens next and the colour under
   *  the open ones' pages. */
  setTheme: (id: string, bg: string) => invoke<void>("set_theme", { id, bg }),
  agentsInfo: () => invoke<AgentsInfo>("agents_info"),
  installClaudeCodeSkill: () => invoke<void>("install_claude_code_skill"),
  revealClaudeCodeSkill: () => invoke<void>("reveal_claude_code_skill"),
  /** Asks where to save; false when the user cancels. */
  saveSkillZip: () => invoke<boolean>("save_skill_zip"),
  createStarterReadme: () => invoke<void>("create_starter_readme"),
  gitStatus: () => invoke<GitStatus>("git_status"),
  gitLog: (limit?: number) => invoke<GitLogEntry[]>("git_log", { limit }),
  gitCommit: (message: string, push: boolean) =>
    invoke<CommitResult>("git_commit", { message, push }),
  gitPush: () => invoke<CommitResult>("git_push"),
  pickNotesDir: () => invoke<string | null>("pick_notes_dir"),
  setNotesDir: (path: string, moveExisting: boolean) =>
    invoke<string>("set_notes_dir", { path, moveExisting }),
  // Files outside the notes folder, addressed by absolute path. Rust serves
  // only paths it admitted itself (Finder open, Open… panel, saved session).
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("write_file", { path, content }),
  closeFile: (path: string) => invoke<void>("close_file", { path }),
  /** What the OS asked Parker to open since the last call: bare names are
   *  notes in the folder, everything else an absolute path. */
  takeOpenedFiles: () => invoke<string[]>("take_opened_files"),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openHelp: () => invoke<void>("open_help"),
  quit: () => invoke<void>("quit"),
  // Note windows — a note in a window of its own (src-tauri/src/windows.rs).
  /** Open, or bring forward, the window for this note — on its preview when
   *  `preview`, under the pointer when `atCursor`. Returns its label. */
  openNoteWindow: (name: string, preview: boolean, atCursor: boolean) =>
    invoke<string>("open_note_window", { name, preview, atCursor }),
  /** This note window now shows another note, or the same one the other way. */
  setNoteWindowNote: (name: string, preview: boolean) =>
    invoke<void>("set_note_window_note", { name, preview }),
  setWindowOnTop: (onTop: boolean) => invoke<void>("set_window_on_top", { onTop }),
  /** True when another window shows the note and was brought forward. */
  focusNote: (name: string) => invoke<boolean>("focus_note", { name }),
  /** Hand this window's note back to the main window and close. */
  dockNote: (name: string, preview: boolean) => invoke<void>("dock_note", { name, preview }),
  closeNoteWindow: () => invoke<void>("close_note_window"),
  /** Is the pointer outside this window right now? For the end of a drag. */
  pointerOutsideWindow: () => invoke<boolean>("pointer_outside_window"),
};
