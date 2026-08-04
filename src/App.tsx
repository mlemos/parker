import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import { EditorView } from "@uiw/react-codemirror";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./lib/api";
import { languageForName } from "./lib/lang";
import { DEFAULT_THEME_ID, nextThemeId, themeById } from "./lib/themes";
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
  const [langExt, setLangExt] = useState<Extension[]>([]);
  const [ready, setReady] = useState(false);

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

  // Reflect chrome colors as CSS variables on the root element.
  useEffect(() => {
    const root = document.documentElement;
    const c = theme.chrome;
    root.style.setProperty("--bg", c.bg);
    root.style.setProperty("--fg", c.fg);
    root.style.setProperty("--muted", c.muted);
    root.style.setProperty("--border", c.border);
    root.style.setProperty("--tab-bg", c.tabBg);
    root.style.setProperty("--tab-active-bg", c.tabActiveBg);
    root.style.setProperty("--accent", c.accent);
    root.dataset.mode = theme.mode;
  }, [theme]);

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

  const cycleTheme = useCallback(() => {
    setThemeId((id) => nextThemeId(id));
  }, []);

  // ---- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();

      if (k === "t" && e.shiftKey) {
        e.preventDefault();
        cycleTheme();
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
  }, [newTab, closeTab, flushSave, cycleTheme, switchByOffset, switchToIndex]);

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

  // The guarantee: intercept window close (red button and Cmd+Q both route
  // here), flush every dirty buffer, then actually destroy the window.
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
          await win.destroy();
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

  // ---- Render --------------------------------------------------------------

  if (!ready) {
    return <div className="parker-loading">Parker</div>;
  }

  const cmExtensions: Extension[] = [theme.cm, EditorView.lineWrapping, ...langExt];

  return (
    <div className="parker">
      <div className="tabbar" data-tauri-drag-region>
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.name}
              className={"tab" + (t.name === activeName ? " active" : "")}
              onClick={() => setActiveName(t.name)}
              title={t.name}
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
          ))}
          <button className="tab-new" onClick={newTab} title="New note (Cmd+T)">
            +
          </button>
        </div>
        <button
          className="theme-btn"
          onClick={cycleTheme}
          title="Cycle theme (Cmd+Shift+T)"
        >
          {theme.label}
        </button>
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
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
              highlightSelectionMatches: false,
            }}
          />
        )}
      </div>

      <div className="statusbar">
        <span className="status-file">{activeTab?.name ?? ""}</span>
        <span className="status-spacer" />
        <span className="status-count">
          {activeTab ? `${activeTab.content.length} chars` : ""}
        </span>
        <span className="status-dir" title={notesDir}>
          {notesDir}
        </span>
      </div>
    </div>
  );
}
