import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import { EditorView, Prec } from "@uiw/react-codemirror";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { languageForName } from "./lib/lang";
import { todoHighlighter } from "./lib/todo";
import { prettyPath } from "./lib/path";
import { DEFAULT_THEME_ID, nextThemeId, themeById } from "./lib/themes";
import { RenameInput } from "./components/RenameInput";
import { NotePicker } from "./components/NotePicker";
import { GitMenu } from "./components/GitMenu";
import { Settings } from "./components/Settings";
import "./App.css";

interface Tab {
  name: string; // filename — unique id for the tab
  content: string;
  dirty: boolean; // has unsaved changes (drives the save dot)
}

const AUTOSAVE_MS = 500;
const SESSION_MS = 400;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [notesDir, setNotesDir] = useState<string>("");
  const [homeDir, setHomeDir] = useState<string>("");
  const [langExt, setLangExt] = useState<Extension[]>([]);
  const [ready, setReady] = useState(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => {
    const v = Number(localStorage.getItem("parker.fontSize"));
    return v >= 9 && v <= 40 ? v : 14;
  });
  const [gutterOn, setGutterOn] = useState<boolean>(
    () => localStorage.getItem("parker.gutter") === "1"
  );
  const [wrapOn, setWrapOn] = useState<boolean>(
    () => localStorage.getItem("parker.wrap") !== "0" // default: wrap on
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Mirror state into refs so the global keydown handler is never stale.
  const stateRef = useRef({ tabs, activeName, themeId });
  stateRef.current = { tabs, activeName, themeId };

  const saveTimers = useRef<Map<string, number>>(new Map());
  const sessionTimer = useRef<number | null>(null);
  const didInit = useRef(false); // guards against StrictMode double-invoke

  const theme = themeById(themeId);
  const activeTab = tabs.find((t) => t.name === activeName) ?? null;

  // ---- Persistence helpers -------------------------------------------------

  const flushSave = useCallback(async (name: string) => {
    const timers = saveTimers.current;
    const pending = timers.get(name);
    if (pending) {
      clearTimeout(pending);
      timers.delete(name);
    }
    const tab = stateRef.current.tabs.find((t) => t.name === name);
    if (!tab) return;
    try {
      await api.writeNote(name, tab.content);
      setTabs((prev) =>
        prev.map((t) => (t.name === name ? { ...t, dirty: false } : t))
      );
    } catch (e) {
      console.error("save failed", name, e);
    }
  }, []);

  const scheduleSave = useCallback(
    (name: string) => {
      const timers = saveTimers.current;
      const existing = timers.get(name);
      if (existing) clearTimeout(existing);
      timers.set(
        name,
        window.setTimeout(() => flushSave(name), AUTOSAVE_MS)
      );
    },
    [flushSave]
  );

  // Flush every dirty buffer and the session synchronously. Used right before
  // the window closes so no keystroke is ever lost on quit.
  const flushAll = useCallback(async () => {
    const s = stateRef.current;
    await Promise.all(
      s.tabs
        .filter((t) => t.dirty)
        .map((t) => api.writeNote(t.name, t.content).catch(() => {}))
    );
    await api
      .saveSession({
        open: s.tabs.map((t) => t.name),
        active: s.activeName,
        theme: s.themeId,
      })
      .catch(() => {});
  }, []);

  const scheduleSessionSave = useCallback(() => {
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    sessionTimer.current = window.setTimeout(() => {
      const s = stateRef.current;
      api
        .saveSession({
          open: s.tabs.map((t) => t.name),
          active: s.activeName,
          theme: s.themeId,
        })
        .catch((e) => console.error("session save failed", e));
    }, SESSION_MS);
  }, []);

  // ---- Startup: restore session -------------------------------------------

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        setHomeDir(await api.homeDirPath());
        setNotesDir(await api.notesDirPath());
        const session = await api.loadSession();

        const restored: Tab[] = [];
        for (const name of session.open ?? []) {
          try {
            const content = await api.readNote(name);
            restored.push({ name, content, dirty: false });
          } catch {
            // Note was deleted/renamed outside the app — skip it.
          }
        }

        if (restored.length === 0) {
          const name = await api.createNote("md");
          restored.push({ name, content: "", dirty: false });
        }

        const active =
          session.active && restored.some((t) => t.name === session.active)
            ? session.active
            : restored[0].name;

        setTabs(restored);
        setActiveName(active);
        if (session.theme) setThemeId(session.theme);
      } catch (e) {
        console.error("startup failed", e);
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the language extension whenever the active note changes.
  useEffect(() => {
    if (!activeName) return;
    let alive = true;
    languageForName(activeName).then((ext) => {
      if (alive) setLangExt(ext);
    });
    return () => {
      alive = false;
    };
  }, [activeName]);

  // Persist session whenever the tab set / active tab / theme changes.
  const openKey = tabs.map((t) => t.name).join(" ");
  useEffect(() => {
    if (ready) scheduleSessionSave();
  }, [openKey, activeName, themeId, ready, scheduleSessionSave]);

  // Reflect the theme's named UI roles as CSS variables on the root element.
  useEffect(() => {
    const root = document.documentElement;
    const u = theme.ui;
    const vars: Record<string, string> = {
      // named app areas
      "--editor-bg": u.editorBg,
      "--editor-fg": u.editorFg,
      "--current-line": u.currentLine,
      "--selection": u.selection,
      "--header-bg": u.headerBg,
      "--field-bg": u.fieldBg,
      "--tabbar-bg": u.tabbarBg,
      "--tab-active-bg": u.tabActiveBg,
      "--status-bg": u.statusBg,
      "--popover-bg": u.popoverBg,
      // shared roles
      "--text": u.text,
      "--secondary": u.secondary,
      "--muted": u.muted,
      "--border": u.border,
      "--accent": u.accent,
      "--on-accent": u.onAccent,
      "--danger": u.danger,
      // legacy aliases so any unmigrated rule still resolves
      "--canvas": u.editorBg,
      "--surface-1": u.tabbarBg,
      "--surface-2": u.headerBg,
      "--surface-3": u.tabActiveBg,
      "--bg": u.editorBg,
      "--fg": u.text,
      "--text-muted": u.muted,
      "--tab-bg": u.headerBg,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.mode = theme.mode;
    root.dataset.theme = theme.id;
  }, [theme]);

  // Editor font size — persist and publish as a CSS var the .cm-editor reads.
  useEffect(() => {
    localStorage.setItem("parker.fontSize", String(fontSize));
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${fontSize}px`
    );
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem("parker.gutter", gutterOn ? "1" : "0");
  }, [gutterOn]);

  useEffect(() => {
    localStorage.setItem("parker.wrap", wrapOn ? "1" : "0");
  }, [wrapOn]);

  // ---- Actions -------------------------------------------------------------

  const onChange = useCallback(
    (value: string) => {
      const name = stateRef.current.activeName;
      if (!name) return;
      setTabs((prev) =>
        prev.map((t) =>
          t.name === name ? { ...t, content: value, dirty: true } : t
        )
      );
      scheduleSave(name);
    },
    [scheduleSave]
  );

  const newTab = useCallback(async () => {
    try {
      const name = await api.createNote("md");
      setTabs((prev) => [...prev, { name, content: "", dirty: false }]);
      setActiveName(name);
    } catch (e) {
      console.error("new tab failed", e);
    }
  }, []);

  const closeTab = useCallback(
    async (name: string) => {
      await flushSave(name); // never drop unsaved work on close
      const cur = stateRef.current.tabs;
      const idx = cur.findIndex((t) => t.name === name);
      const remaining = cur.filter((t) => t.name !== name);

      if (remaining.length === 0) {
        // Keep at least one tab so the editor is never empty-headed.
        const fresh = await api.createNote("md");
        setTabs([{ name: fresh, content: "", dirty: false }]);
        setActiveName(fresh);
        return;
      }

      setTabs(remaining);
      if (stateRef.current.activeName === name) {
        const neighbor = remaining[Math.min(idx, remaining.length - 1)];
        setActiveName(neighbor.name);
      }
    },
    [flushSave]
  );

  const switchToIndex = useCallback((i: number) => {
    const t = stateRef.current.tabs[i];
    if (t) setActiveName(t.name);
  }, []);

  const switchByOffset = useCallback((delta: number) => {
    const { tabs, activeName } = stateRef.current;
    if (tabs.length === 0) return;
    const i = tabs.findIndex((t) => t.name === activeName);
    const next = (i + delta + tabs.length) % tabs.length;
    setActiveName(tabs[next].name);
  }, []);

  // Move the tab at `from` to position `to` (drag-reorder). The active tab is
  // tracked by name, so it stays selected wherever it lands.
  const moveTab = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= prev.length ||
        to >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // Keyboard reorder: shift the active tab left/right (⌘⇧[ / ⌘⇧]).
  const moveActiveTab = useCallback(
    (delta: number) => {
      const { tabs, activeName } = stateRef.current;
      const i = tabs.findIndex((t) => t.name === activeName);
      if (i < 0) return;
      moveTab(i, i + delta);
    },
    [moveTab]
  );

  const cycleTheme = useCallback(() => {
    setThemeId((id) => nextThemeId(id));
  }, []);

  // Open an existing note by name: focus it if already a tab, else load it.
  const openNote = useCallback(async (name: string) => {
    if (stateRef.current.tabs.some((t) => t.name === name)) {
      setActiveName(name);
      return;
    }
    try {
      const content = await api.readNote(name);
      setTabs((prev) => [...prev, { name, content, dirty: false }]);
      setActiveName(name);
    } catch (e) {
      console.error("open failed", name, e);
    }
  }, []);

  // The picker searches (name + content) on its own; just open it.
  const openPicker = useCallback(() => setPickerOpen(true), []);

  const startRename = useCallback((name?: string) => {
    const n = name ?? stateRef.current.activeName;
    if (n) setRenamingName(n);
  }, []);

  const commitRename = useCallback(
    async (oldName: string, raw: string) => {
      setRenamingName(null);
      const newName = raw.trim();
      if (!newName || newName === oldName) return;
      try {
        await flushSave(oldName); // make sure disk has the latest content
        await api.renameNote(oldName, newName);
        const timers = saveTimers.current;
        const pending = timers.get(oldName);
        if (pending) {
          clearTimeout(pending);
          timers.delete(oldName);
        }
        setTabs((prev) =>
          prev.map((t) => (t.name === oldName ? { ...t, name: newName } : t))
        );
        setActiveName((a) => (a === oldName ? newName : a));
      } catch (e) {
        console.error("rename failed", e); // keep the old name on failure
      }
    },
    [flushSave]
  );

  // ---- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F2 renames the active tab (no modifier).
      if (e.key === "F2") {
        e.preventDefault();
        startRename();
        return;
      }
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();

      if (k === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      } else if (k === "t" && e.shiftKey) {
        e.preventDefault();
        cycleTheme();
      } else if (k === "r" && e.shiftKey) {
        e.preventDefault();
        startRename();
      } else if (k === "l" && e.shiftKey) {
        e.preventDefault();
        setGutterOn((v) => !v);
      } else if (k === "s" && e.shiftKey) {
        // Handled by GitMenu (quick commit & push); swallow here so the plain
        // ⌘S save branch below doesn't also fire.
        e.preventDefault();
      } else if (k === "=" || k === "+") {
        e.preventDefault();
        setFontSize((f) => Math.min(40, f + 1));
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        setFontSize((f) => Math.max(9, f - 1));
      } else if (k === "0") {
        e.preventDefault();
        setFontSize(14);
      } else if (k === "o") {
        e.preventDefault();
        openPicker();
      } else if (k === "t") {
        e.preventDefault();
        newTab();
      } else if (k === "w") {
        e.preventDefault();
        const active = stateRef.current.activeName;
        if (active) closeTab(active);
      } else if (k === "s") {
        e.preventDefault();
        const active = stateRef.current.activeName;
        if (active) flushSave(active);
      } else if (k === "}") {
        e.preventDefault();
        moveActiveTab(1); // ⌘⇧] — move active tab right
      } else if (k === "{") {
        e.preventDefault();
        moveActiveTab(-1); // ⌘⇧[ — move active tab left
      } else if (k === "]") {
        e.preventDefault();
        switchByOffset(1);
      } else if (k === "[") {
        e.preventDefault();
        switchByOffset(-1);
      } else if (k >= "1" && k <= "9") {
        e.preventDefault();
        switchToIndex(Number(k) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    newTab,
    closeTab,
    flushSave,
    cycleTheme,
    switchByOffset,
    switchToIndex,
    moveActiveTab,
    startRename,
    openPicker,
  ]);

  // Insurance: flush everything when the window loses focus.
  useEffect(() => {
    const onBlur = () => {
      for (const t of stateRef.current.tabs) {
        if (t.dirty) flushSave(t.name);
      }
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flushSave]);

  // Menu-bar app: closing the window (red button) does NOT quit — it flushes
  // and hides Parker back to the menu bar, so it stays instantly available.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const win = getCurrentWindow();
    win
      .onCloseRequested(async (e) => {
        e.preventDefault();
        try {
          await flushAll();
        } finally {
          await win.hide();
        }
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flushAll]);

  // Real quit (tray / app menu / Cmd+Q) routes here: flush everything, then
  // ask the backend to exit — so nothing is lost even when quitting from the
  // menu bar while the window is hidden.
  useEffect(() => {
    const p = listen("parker://quit", async () => {
      try {
        await flushAll();
      } finally {
        await api.quit().catch(() => {});
      }
    });
    return () => {
      p.then((un) => un());
    };
  }, [flushAll]);

  // Open Settings when asked from the tray or the native menu (Cmd+,).
  useEffect(() => {
    const p = listen("parker://open-settings", () => setSettingsOpen(true));
    return () => {
      p.then((un) => un());
    };
  }, []);

  // External-change reload: the backend watches the notes folder and fires this
  // when a file changes on disk (git pull, another machine, another editor).
  // Reload the open tab — but never over unsaved edits (protect the user's
  // typing), and skip our own autosave writes (disk already equals the buffer).
  useEffect(() => {
    const timers = new Map<string, number>();
    const reload = async (name: string) => {
      const before = stateRef.current.tabs.find((t) => t.name === name);
      if (!before || before.dirty) return;
      let disk: string;
      try {
        disk = await api.readNote(name);
      } catch {
        return; // deleted/unreadable externally — keep the buffer as-is
      }
      // Re-check after the await: the user may have started typing meanwhile.
      const now = stateRef.current.tabs.find((t) => t.name === name);
      if (!now || now.dirty || now.content === disk) return;
      setTabs((prev) =>
        prev.map((t) =>
          t.name === name ? { ...t, content: disk, dirty: false } : t
        )
      );
    };
    const p = listen<string>("parker://note-changed", (e) => {
      const name = e.payload;
      if (!stateRef.current.tabs.some((t) => t.name === name)) return;
      const existing = timers.get(name);
      if (existing) clearTimeout(existing);
      // Debounce: editors/git emit several events per save.
      timers.set(
        name,
        window.setTimeout(() => {
          timers.delete(name);
          reload(name);
        }, 150)
      );
    });
    return () => {
      p.then((un) => un());
      for (const id of timers.values()) clearTimeout(id);
    };
  }, []);

  // ---- Render --------------------------------------------------------------

  if (!ready) {
    return <div className="parker-loading">Parker</div>;
  }

  // Our theme is the ONLY syntax highlighter (basicSetup's default is disabled
  // below). No competing highlighter means markdown link text/URL use our
  // colors; tags we don't define simply render as plain editor text.
  const cmExtensions: Extension[] = [
    Prec.highest(theme.cm),
    ...(wrapOn ? [EditorView.lineWrapping] : []),
    todoHighlighter,
    ...langExt,
  ];

  return (
    <div className="parker">
      <div className="titlebar" data-tauri-drag-region>
        <div className="tb-left" data-tauri-drag-region />
        <div className="tb-center" data-tauri-drag-region>
          <button
            className="search-bar"
            onClick={openPicker}
            title="Search notes (Cmd+O)"
          >
            <svg
              className="search-icon"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="search-text">
              {activeTab?.name ?? "Search notes…"}
            </span>
            <span className="search-kbd">⌘O</span>
          </button>
        </div>
        <div className="tb-right" data-tauri-drag-region>
          <button
            className={"icon-btn" + (gutterOn ? " on" : "")}
            onClick={() => setGutterOn((v) => !v)}
            title="Line numbers (Cmd+Shift+L)"
            aria-label="Toggle line numbers"
            aria-pressed={gutterOn}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="3" y2="6" />
              <line x1="3" y1="12" x2="3" y2="12" />
              <line x1="3" y1="18" x2="3" y2="18" />
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <button
            className={"icon-btn" + (wrapOn ? " on" : "")}
            onClick={() => setWrapOn((v) => !v)}
            title="Wrap long lines"
            aria-label="Toggle line wrap"
            aria-pressed={wrapOn}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
              <polyline points="16 16 14 18 16 20" />
              <line x1="3" y1="18" x2="10" y2="18" />
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={cycleTheme}
            title={`Theme: ${theme.label} — cycle (Cmd+Shift+T)`}
            aria-label="Cycle theme"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path
                d="M12 3 a9 9 0 0 0 0 18 z"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings (Cmd+,)"
            aria-label="Settings"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="tabstrip">
        <div className="tabs">
          {tabs.map((t, i) =>
            renamingName === t.name ? (
              <div key={t.name} className="tab active editing">
                <RenameInput
                  initial={t.name}
                  onCommit={(v) => commitRename(t.name, v)}
                  onCancel={() => setRenamingName(null)}
                />
              </div>
            ) : (
              <button
                key={t.name}
                className={
                  "tab" +
                  (t.name === activeName ? " active" : "") +
                  (i === dragIndex ? " dragging" : "") +
                  (i === overIndex && dragIndex !== null && dragIndex !== i
                    ? " drag-over"
                    : "")
                }
                draggable
                onClick={() => setActiveName(t.name)}
                onDoubleClick={() => startRename(t.name)}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) moveTab(dragIndex, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                title={`${t.name}  —  double-click or F2 to rename`}
              >
                <span className="tab-name">{t.name}</span>
                <span
                  className={"tab-dot" + (t.dirty ? " dirty" : "")}
                  aria-hidden
                />
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.name);
                  }}
                  title="Close (Cmd+W)"
                >
                  ×
                </span>
              </button>
            )
          )}
          <button className="tab-new" onClick={newTab} title="New note (Cmd+T)">
            +
          </button>
        </div>
      </div>

      <div className="editor-wrap">
        {activeTab && (
          <CodeMirror
            key={activeTab.name}
            value={activeTab.content}
            onChange={onChange}
            theme={theme.mode}
            extensions={cmExtensions}
            height="100%"
            autoFocus
            basicSetup={{
              lineNumbers: gutterOn,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: gutterOn,
              highlightSelectionMatches: false,
              // Our theme is the SOLE syntax highlighter — disable CM's default
              // so nothing competes for markdown link/mark colors.
              syntaxHighlighting: false,
            }}
          />
        )}
      </div>

      <div className="statusbar">
        <span className="status-file">{activeTab?.name ?? ""}</span>
        <GitMenu onBeforeCommit={flushAll} />
        <span className="status-spacer" />
        <span className="status-count">
          {activeTab
            ? `${activeTab.content.split("\n").length} lines · ${
                activeTab.content.length
              } chars`
            : ""}
        </span>
        <span className="status-dir" title={notesDir}>
          {prettyPath(notesDir, homeDir)}
        </span>
      </div>

      {pickerOpen && (
        <NotePicker
          openNames={tabs.map((t) => t.name)}
          onOpen={(name) => {
            setPickerOpen(false);
            openNote(name);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {settingsOpen && (
        <Settings
          homeDir={homeDir}
          onClose={() => setSettingsOpen(false)}
          onNotesDirChange={(dir) => setNotesDir(dir)}
        />
      )}
    </div>
  );
}
