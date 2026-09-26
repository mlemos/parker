// The Settings window: a window of its own, like System Settings — sections in
// a sidebar on the left, the chosen one on the right. It talks to the rest of
// the app only through Rust: every change is a command, and the editor windows
// follow along through the events Rust already broadcasts (parker://prefs,
// parker://theme, parker://notes-dir).
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Bot, GitBranch, PenLine, Shield, SlidersHorizontal } from "lucide-react";
import { THEMES, themeById, DEFAULT_THEME_ID } from "./lib/themes";
import { prettyPath } from "./lib/path";
import { accelFromEvent, prettyShortcut } from "./lib/shortcut";
import { TEXT_WIDTHS, textWidthOf } from "./lib/text-width";
import { IMAGE_MODES, imageModeOf } from "./lib/images";
import type { ImageMode } from "./lib/images";
import type { TextWidth } from "./lib/text-width";
import type { AgentsInfo, SettingsInfo } from "./lib/api";

export type { AgentsInfo };
import "./App.css";

/** Everything the window needs from the outside. The app passes the real
 *  commands; the harness passes a fake, so the window can be seen and tested
 *  in a plain browser. */
export interface SettingsBackend {
  getSettings(): Promise<SettingsInfo>;
  homeDir(): Promise<string>;
  setAutostart(on: boolean): Promise<void>;
  pickNotesDir(): Promise<string | null>;
  setNotesDir(path: string, moveExisting: boolean): Promise<string>;
  setShortcut(accel: string): Promise<void>;
  setGitAutoSync(on: boolean): Promise<void>;
  setGitSyncInterval(minutes: number): Promise<void>;
  setEditorPrefs(gutter: boolean, wrap: boolean, ligatures: boolean, width: number): Promise<void>;
  setPreviewSync(on: boolean): Promise<void>;
  setPreviewImages(mode: ImageMode): Promise<void>;
  setTheme(id: string): Promise<void>;
  agentsInfo(): Promise<AgentsInfo>;
  installClaudeCodeSkill(): Promise<void>;
  revealClaudeCodeSkill(): Promise<void>;
  /** Asks where to save; resolves false when the user cancels. */
  saveSkillZip(): Promise<boolean>;
  createStarterReadme(): Promise<void>;
  openUrl(url: string): Promise<void>;
  /** Live updates from the other windows; returns an unsubscribe. */
  onTheme(cb: (id: string) => void): () => void;
  onPrefs(cb: (s: Partial<SettingsInfo>) => void): () => void;
}

export type SectionId = "general" | "editor" | "git" | "privacy" | "agents";

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <SlidersHorizontal size={15} strokeWidth={1.8} /> },
  { id: "editor", label: "Editor", icon: <PenLine size={15} strokeWidth={1.8} /> },
  { id: "git", label: "Backup & Git", icon: <GitBranch size={15} strokeWidth={1.8} /> },
  { id: "privacy", label: "Privacy & Security", icon: <Shield size={15} strokeWidth={1.8} /> },
  { id: "agents", label: "AI Agents", icon: <Bot size={15} strokeWidth={1.8} /> },
];

export const SECTION_KEY = "parker.settings.section";
const SYNC_INTERVALS = [0, 5, 15, 30, 60] as const;
const intervalLabel = (m: number) => (m === 0 ? "Off" : m === 60 ? "1 h" : `${m} min`);
export const AGENTS_URL = "https://getparker.dev/agents";

/** The first section to show: the one used last, if it still exists. */
export function initialSection(saved: string | null): SectionId {
  return SECTIONS.some((s) => s.id === saved) ? (saved as SectionId) : "general";
}

/** Paint a theme onto this window (the same variables the editor sets). */
export function applyWindowTheme(id: string) {
  const t = themeById(id);
  const u = t.ui;
  const vars: Record<string, string> = {
    "--popover-bg": u.popoverBg,
    "--text": u.text,
    "--fg": u.text,
    "--secondary": u.secondary,
    "--muted": u.muted,
    "--text-muted": u.muted,
    "--border": u.border,
    "--accent": u.accent,
    "--on-accent": u.onAccent,
    "--danger": u.danger,
    "--bg": u.editorBg,
    "--editor-bg": u.editorBg,
    "--header-bg": u.headerBg,
    "--tabbar-bg": u.tabbarBg,
    "--tab-active-bg": u.tabActiveBg,
    "--todo-done": t.todo.done,
    "--todo-attn": t.todo.attn,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = t.mode;
  root.dataset.theme = t.id;
  document.body.style.background = u.editorBg;
}

function Switch({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button className={"switch" + (on ? " on" : "")} onClick={onClick} disabled={disabled} role="switch" aria-checked={on} aria-label={label}>
      <span className="switch-knob" />
    </button>
  );
}

function Row({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <div className="settings-title">{title}</div>
        {sub && <div className="settings-sub">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsWindow({ backend, initialTheme }: { backend: SettingsBackend; initialTheme?: string }) {
  const [section, setSection] = useState<SectionId>(() => {
    try {
      return initialSection(localStorage.getItem(SECTION_KEY));
    } catch {
      return "general";
    }
  });
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [home, setHome] = useState("");
  const [themeId, setThemeId] = useState(initialTheme || DEFAULT_THEME_ID);
  const [agents, setAgents] = useState<AgentsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshAgents = useCallback(() => {
    backend.agentsInfo().then(setAgents).catch((e) => setError(String(e)));
  }, [backend]);

  useEffect(() => {
    backend.getSettings().then(setInfo).catch((e) => setError(String(e)));
    backend.homeDir().then(setHome).catch(() => {});
    refreshAgents();
    const offTheme = backend.onTheme((id) => setThemeId(id));
    const offPrefs = backend.onPrefs((p) => setInfo((cur) => (cur ? { ...cur, ...p } : cur)));
    return () => {
      offTheme();
      offPrefs();
    };
  }, [backend, refreshAgents]);

  useEffect(() => applyWindowTheme(themeId), [themeId]);

  const choose = (id: SectionId) => {
    setSection(id);
    setError(null);
    setNotice(null);
    try {
      localStorage.setItem(SECTION_KEY, id);
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };

  // Record a new global shortcut while the button is armed.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      const accel = accelFromEvent(e);
      if (!accel) return;
      setRecording(false);
      backend
        .setShortcut(accel)
        .then(() => setInfo((cur) => (cur ? { ...cur, shortcut: accel } : cur)))
        .catch((err) => setError(String(err)));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, backend]);

  /** Run a command with the window marked busy and errors shown in place. */
  const run = async (f: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const editorPrefs = (patch: Partial<Pick<SettingsInfo, "editor_gutter" | "editor_wrap" | "editor_ligatures" | "editor_width">>) =>
    run(async () => {
      if (!info) return;
      const n = { ...info, ...patch };
      await backend.setEditorPrefs(n.editor_gutter, n.editor_wrap, n.editor_ligatures, n.editor_width);
      setInfo(n);
    });

  const title = SECTIONS.find((s) => s.id === section)!.label;

  return (
    <div className="setwin">
      <div className="titlebar" data-tauri-drag-region>
        <div className="tb-left" data-tauri-drag-region />
        <div className="tb-center" data-tauri-drag-region>
          <span className="helpwin-title" data-tauri-drag-region>Settings</span>
        </div>
        <div className="tb-right" data-tauri-drag-region />
      </div>
      <div className="setwin-split">
      <aside className="setwin-side">
        <nav aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={"setwin-item" + (s.id === section ? " on" : "")} onClick={() => choose(s.id)} aria-current={s.id === section ? "page" : undefined}>
              <span className="setwin-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="setwin-main">
        <div className="setwin-body">
          <h1 className="setwin-h1">{title}</h1>
          {!info && !error && <div className="settings-loading">Loading…</div>}

          {info && section === "general" && (
            <>
              <Row title="Launch at login" sub="Start Parker when you log in to your Mac.">
                <Switch on={info.autostart} disabled={busy} label="Launch at login" onClick={() => run(async () => {
                  await backend.setAutostart(!info.autostart);
                  setInfo({ ...info, autostart: !info.autostart });
                })} />
              </Row>
              <Row title="Notes folder" sub={<span className="settings-path" title={info.notes_dir}>{prettyPath(info.notes_dir, home)}</span>}>
                <button className="settings-btn" disabled={busy || pendingDir !== null} onClick={() => run(async () => {
                  const picked = await backend.pickNotesDir();
                  if (picked && picked !== info.notes_dir) setPendingDir(picked);
                })}>Change…</button>
              </Row>
              {pendingDir && (
                <div className="settings-confirm">
                  <div className="settings-sub">
                    Move your existing notes into <span className="settings-path">{prettyPath(pendingDir, home)}</span>?
                  </div>
                  <div className="settings-confirm-actions">
                    <button className="settings-btn" disabled={busy} onClick={() => setPendingDir(null)}>Cancel</button>
                    <button className="settings-btn" disabled={busy} onClick={() => run(async () => {
                      const dir = await backend.setNotesDir(pendingDir, false);
                      setInfo({ ...info, notes_dir: dir });
                      setPendingDir(null);
                      refreshAgents();
                    })}>Just switch</button>
                    <button className="settings-btn primary" disabled={busy} onClick={() => run(async () => {
                      const dir = await backend.setNotesDir(pendingDir, true);
                      setInfo({ ...info, notes_dir: dir });
                      setPendingDir(null);
                      refreshAgents();
                    })}>Move my notes</button>
                  </div>
                </div>
              )}
              <Row title="Global shortcut" sub={recording ? "Press the new shortcut… (Esc to cancel)" : "Summon or hide Parker from any app."}>
                <div className="settings-shortcut">
                  <button className={"kbd kbd-btn" + (recording ? " recording" : "")} disabled={busy} onClick={() => setRecording((r) => !r)} title="Click, then press a new shortcut">
                    {recording ? "Recording…" : prettyShortcut(info.shortcut)}
                  </button>
                  {!recording && info.shortcut !== info.default_shortcut && (
                    <button className="link-btn" disabled={busy} onClick={() => run(async () => {
                      await backend.setShortcut(info.default_shortcut);
                      setInfo({ ...info, shortcut: info.default_shortcut });
                    })}>Reset to {prettyShortcut(info.default_shortcut)}</button>
                  )}
                </div>
              </Row>
            </>
          )}

          {info && section === "editor" && (
            <>
              <Row title="Theme" sub="⌘⇧T cycles through them from any window.">
                <select className="settings-select" value={themeId} disabled={busy} aria-label="Theme" onChange={(e) => {
                  const id = e.target.value;
                  setThemeId(id);
                  backend.setTheme(id).catch((err) => setError(String(err)));
                }}>
                  {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Row>
              <Row title="Text width" sub="How far a line runs before it wraps, in columns. Window lets it run to the edge.">
                <div className="seg" role="radiogroup" aria-label="Text width">
                  {TEXT_WIDTHS.map((w: TextWidth) => (
                    <button key={w} role="radio" aria-checked={textWidthOf(info.editor_width) === w} className={"seg-btn" + (textWidthOf(info.editor_width) === w ? " on" : "")} disabled={busy} onClick={() => editorPrefs({ editor_width: w })}>
                      {w === 0 ? "Window" : w}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Wrap long lines" sub="Off, a long line runs past the edge and the pane scrolls sideways.">
                <Switch on={info.editor_wrap} disabled={busy} label="Wrap long lines" onClick={() => editorPrefs({ editor_wrap: !info.editor_wrap })} />
              </Row>
              <Row title="Line numbers" sub="The gutter at the left of every note.">
                <Switch on={info.editor_gutter} disabled={busy} label="Line numbers" onClick={() => editorPrefs({ editor_gutter: !info.editor_gutter })} />
              </Row>
              <Row title="Ligatures" sub={<>Draw <code>-&gt;</code> and <code>!=</code> as single glyphs. In prose it can surprise you.</>}>
                <Switch on={info.editor_ligatures} disabled={busy} label="Ligatures" onClick={() => editorPrefs({ editor_ligatures: !info.editor_ligatures })} />
              </Row>
              <Row title="Preview follows the editor" sub="The side-by-side preview scrolls with the note you are writing.">
                <Switch on={info.preview_sync} disabled={busy} label="Preview follows the editor" onClick={() => run(async () => {
                  await backend.setPreviewSync(!info.preview_sync);
                  setInfo({ ...info, preview_sync: !info.preview_sync });
                })} />
              </Row>
            </>
          )}

          {info && section === "git" && (
            <>
              <p className="setwin-intro">When your notes folder is a git repository, Parker can commit and push it for you. Sync anytime with ⌘⇧S.</p>
              <Row title="Sync on quit" sub="Commit and push your notes when you quit Parker.">
                <Switch on={info.git_auto_sync} disabled={busy} label="Sync on quit" onClick={() => run(async () => {
                  await backend.setGitAutoSync(!info.git_auto_sync);
                  setInfo({ ...info, git_auto_sync: !info.git_auto_sync });
                })} />
              </Row>
              <Row title="Sync every" sub="Commit and push on a timer while Parker runs. Skipped when there is nothing to sync.">
                <div className="seg" role="radiogroup" aria-label="Sync interval">
                  {SYNC_INTERVALS.map((m) => (
                    <button key={m} role="radio" aria-checked={info.git_sync_interval === m} className={"seg-btn" + (info.git_sync_interval === m ? " on" : "")} disabled={busy} onClick={() => run(async () => {
                      await backend.setGitSyncInterval(m);
                      setInfo({ ...info, git_sync_interval: m });
                    })}>{intervalLabel(m)}</button>
                  ))}
                </div>
              </Row>
            </>
          )}

          {info && section === "privacy" && (
            <>
              <p className="setwin-intro">Parker makes no network requests of its own. The one thing a note can ask for is an image from the web — this is where you decide.</p>
              <Row
                title="Images in preview"
                sub="Local images are files next to your notes; they never leave this Mac."
              >
                <div className="seg" role="radiogroup" aria-label="Images in preview">
                  {IMAGE_MODES.map((m) => {
                    const on = imageModeOf(info.preview_images) === m.id;
                    return (
                      <button key={m.id} role="radio" aria-checked={on} className={"seg-btn" + (on ? " on" : "")} disabled={busy} onClick={() => run(async () => {
                        await backend.setPreviewImages(m.id);
                        setInfo({ ...info, preview_images: m.id });
                      })}>{m.label}</button>
                    );
                  })}
                </div>
              </Row>
              {imageModeOf(info.preview_images) === "all" && (
                <p className="setwin-warn" role="note">
                  Remote images are fetched from their servers when a note opens: whoever hosts them can see when, and from which IP address.
                </p>
              )}
            </>
          )}

          {section === "agents" && (
            <>
              <p className="setwin-intro">
                Your notes are plain files, so an AI agent can read and write them while you watch. The Parker skill teaches it the to-do marks, how to edit without damaging a note, and how to hand decisions back to you.
              </p>

              <section className="setwin-card">
                <div className="setwin-card-head">
                  <div>
                    <div className="settings-title">Claude Code</div>
                    <div className="settings-sub">Also the Code tab of the Claude desktop app.</div>
                  </div>
                  <span className={"setwin-status " + (agents?.claude_code ?? "")}>
                    {agents?.claude_code === "current" ? "Installed" : agents?.claude_code === "different" ? "Another version" : agents ? "Not installed" : ""}
                  </span>
                </div>
                <div className="settings-sub">
                  {agents?.claude_code === "different"
                    ? <>The skill in <span className="settings-path">{agents.claude_code_dir}</span> isn't the one this Parker ships. Updating replaces it.</>
                    : <>Installs into <span className="settings-path">{agents?.claude_code_dir ?? "~/.claude/skills/parker"}</span>. Claude Code picks it up in its next session.</>}
                </div>
                <div className="setwin-actions">
                  {agents?.claude_code !== "current" && (
                    <button className="settings-btn primary" disabled={busy || !agents} onClick={() => run(async () => {
                      await backend.installClaudeCodeSkill();
                      setNotice(agents?.claude_code === "different" ? "Updated. New Claude Code sessions use it." : "Installed. New Claude Code sessions use it.");
                      refreshAgents();
                    })}>{agents?.claude_code === "different" ? "Update" : "Install"}</button>
                  )}
                  {agents && agents.claude_code !== "missing" && (
                    <button className="settings-btn" disabled={busy} onClick={() => run(() => backend.revealClaudeCodeSkill())}>Show in Finder</button>
                  )}
                </div>
              </section>

              <section className="setwin-card">
                <div className="settings-title">Claude app — desktop, Cowork, claude.ai</div>
                <div className="settings-sub">
                  The Claude app keeps skills in your account. Save the skill as a .zip, then in Claude open <b>Customize › Skills</b>, click <b>+</b>, choose <b>Upload a skill</b>, and pick the file. It needs <b>Code execution</b> turned on in Claude's Settings › Capabilities.
                </div>
                <div className="setwin-actions">
                  <button className="settings-btn" disabled={busy} onClick={() => run(async () => {
                    if (await backend.saveSkillZip()) setNotice("Saved. In Claude: Customize › Skills › + › Upload a skill.");
                  })}>Save parker-skill.zip…</button>
                </div>
              </section>

              <Row title="Other agents" sub="Codex, Cursor and others read instructions in their own way.">
                <button className="link-btn setwin-link" onClick={() => backend.openUrl(AGENTS_URL).catch(() => {})}>getparker.dev/agents</button>
              </Row>

              <Row title="README for agents" sub={agents?.readme ? "Your notes folder has a README. The Parker skill tells agents to read it before they write, and to follow it where the two differ." : "A short README.md at the root of your notes folder holds your own rules. The Parker skill tells agents to read it before they write."}>
                {agents && !agents.readme && (
                  <button className="settings-btn" disabled={busy} onClick={() => run(async () => {
                    await backend.createStarterReadme();
                    setNotice("Created README.md in your notes folder.");
                    refreshAgents();
                  })}>Create README.md</button>
                )}
              </Row>
            </>
          )}

          {notice && <div className="setwin-notice" role="status">{notice}</div>}
          {error && <div className="settings-error" role="alert">{error}</div>}
        </div>
      </main>
      </div>
    </div>
  );
}
