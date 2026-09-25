// The Settings window's backend in the app: the real commands, and the events
// that keep it and the editor windows in step.
import { emit, listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import type { SettingsInfo } from "./lib/api";
import { openExternal } from "./lib/open";
import { SYNC_INTERVAL_EVENT } from "./components/GitMenu";
import type { SettingsBackend } from "./SettingsWindow";

/** Subscribe to a Tauri event from a synchronous cleanup-returning effect. */
function on<T>(event: string, cb: (payload: T) => void): () => void {
  const p = listen<T>(event, (e) => cb(e.payload));
  return () => {
    p.then((un) => un());
  };
}

export const tauriBackend: SettingsBackend = {
  getSettings: api.getSettings,
  homeDir: api.homeDirPath,
  setAutostart: api.setAutostart,
  pickNotesDir: api.pickNotesDir,
  setNotesDir: api.setNotesDir,
  setShortcut: api.setShortcut,
  setGitAutoSync: api.setGitAutoSync,
  setGitSyncInterval: async (minutes) => {
    await api.setGitSyncInterval(minutes);
    // The timer lives in the editor window; tell it the new choice.
    await emit(SYNC_INTERVAL_EVENT);
  },
  setEditorPrefs: api.setEditorPrefs,
  setPreviewSync: api.setPreviewSync,
  // The theme is one for the app; every window follows parker://theme, and
  // the editor saves it with the session.
  setTheme: (id) => emit("parker://theme", id),
  agentsInfo: api.agentsInfo,
  installClaudeCodeSkill: api.installClaudeCodeSkill,
  revealClaudeCodeSkill: api.revealClaudeCodeSkill,
  saveSkillZip: api.saveSkillZip,
  createStarterReadme: api.createStarterReadme,
  openUrl: async (url) => {
    openExternal(url);
  },
  onTheme: (cb) => on<string>("parker://theme", cb),
  onPrefs: (cb) => on<Partial<SettingsInfo>>("parker://prefs", cb),
};
