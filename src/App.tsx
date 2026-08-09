import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { prettyPath } from "./lib/path";
import { DEFAULT_THEME_ID, nextThemeId, themeById } from "./lib/themes";
import {
  allGroups,
  findGroup,
  firstGroup,
  makeGroup,
  removeGroup,
  resizeSplit,
  splitGroup,
  updateGroup,
} from "./lib/layout";
import type { Buffer, LayoutNode } from "./lib/layout";
import { NotePicker } from "./components/NotePicker";
import { GitMenu } from "./components/GitMenu";
import { Settings } from "./components/Settings";
import { LayoutView } from "./components/LayoutView";
import type { LayoutHandlers } from "./components/LayoutView";
import "./App.css";

const AUTOSAVE_MS = 500;
const SESSION_MS = 400;

export default function App() {
  const [buffers, setBuffers] = useState<Buffer[]>([]);
  const [layout, setLayout] = useState<LayoutNode>(() => makeGroup([], null));
  const [focusedId, setFocusedId] = useState<string>("");
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [notesDir, setNotesDir] = useState<string>("");
  const [homeDir, setHomeDir] = useState<string>("");
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
    () => localStorage.getItem("parker.wrap") !== "0"
  );

  // Mirror state into a ref so global handlers never read stale values.
  const stateRef = useRef({ buffers, layout, focusedId, themeId });
  stateRef.current = { buffers, layout, focusedId, themeId };

  const saveTimers = useRef<Map<string, number>>(new Map());
  const sessionTimer = useRef<number | null>(null);
  const didInit = useRef(false);

  const theme = themeById(themeId);

  // Focused group + its active buffer (drives the header/status bar).
  const groups = allGroups(layout);
  const focusedGroup = findGroup(layout, focusedId) ?? firstGroup(layout);
  const activeName = focusedGroup.active;
  const activeBuf = buffers.find((b) => b.name === activeName) ?? null;
  const multiGroup = groups.length > 1;

  // ---- Persistence helpers -------------------------------------------------

  const focusedActive = (s: typeof stateRef.current): string | null =>
    (findGroup(s.layout, s.focusedId) ?? firstGroup(s.layout)).active;

  const flushSave = useCallback(async (name: string) => {
    const timers = saveTimers.current;
    const pending = timers.get(name);
    if (pending) {
      clearTimeout(pending);
      timers.delete(name);
    }
    const buf = stateRef.current.buffers.find((b) => b.name === name);
    if (!buf) return;
    try {
      await api.writeNote(name, buf.content);
      setBuffers((prev) =>
        prev.map((b) => (b.name === name ? { ...b, dirty: false } : b))
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
      timers.set(name, window.setTimeout(() => flushSave(name), AUTOSAVE_MS));
    },
    [flushSave]
  );

  const flushAll = useCallback(async () => {
    const s = stateRef.current;
    await Promise.all(
      s.buffers
        .filter((b) => b.dirty)
        .map((b) => api.writeNote(b.name, b.content).catch(() => {}))
    );
    await api
      .saveSession({
        open: s.buffers.map((b) => b.name),
        active: focusedActive(s),
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
          open: s.buffers.map((b) => b.name),
          active: focusedActive(s),
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

        const restored: Buffer[] = [];
        for (const name of session.open ?? []) {
          try {
            const content = await api.readNote(name);
            restored.push({ name, content, dirty: false });
          } catch {
            // deleted/renamed outside the app — skip it
          }
        }
        if (restored.length === 0) {
          const name = await api.createNote("md");
          restored.push({ name, content: "", dirty: false });
        }
        const active =
          session.active && restored.some((b) => b.name === session.active)
            ? session.active
            : restored[0].name;

        const g = makeGroup(
          restored.map((b) => b.name),
          active
        );
        setBuffers(restored);
        setLayout(g);
        setFocusedId(g.id);
        if (session.theme) setThemeId(session.theme);
      } catch (e) {
        console.error("startup failed", e);
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session whenever the open set / focus / theme changes.
  const openKey = buffers.map((b) => b.name).join(" ");
  useEffect(() => {
    if (ready) scheduleSessionSave();
  }, [openKey, focusedId, layout, themeId, ready, scheduleSessionSave]);

  // Reflect the theme's named UI roles as CSS variables on the root element.
  useEffect(() => {
    const root = document.documentElement;
    const u = theme.ui;
    const vars: Record<string, string> = {
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
      "--text": u.text,
      "--secondary": u.secondary,
      "--muted": u.muted,
      "--border": u.border,
      "--accent": u.accent,
      "--on-accent": u.onAccent,
      "--danger": u.danger,
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

  // ---- Buffer / tab actions -----------------------------------------------

  // Drop buffers no longer referenced by any group (after a close).
  const gcBuffers = (next: LayoutNode, bufs: Buffer[]): Buffer[] => {
    const referenced = new Set(allGroups(next).flatMap((g) => g.tabs));
    return bufs.filter((b) => referenced.has(b.name));
  };

  const onChange = useCallback(
    (name: string, value: string) => {
      setBuffers((prev) =>
        prev.map((b) =>
          b.name === name ? { ...b, content: value, dirty: true } : b
        )
      );
      scheduleSave(name);
    },
    [scheduleSave]
  );

  const focusGroup = useCallback((id: string) => setFocusedId(id), []);

  const selectTab = useCallback((groupId: string, name: string) => {
    setLayout((l) => updateGroup(l, groupId, { active: name }));
    setFocusedId(groupId);
  }, []);

  const reorderTab = useCallback(
    (groupId: string, from: number, to: number) => {
      setLayout((l) => {
        const g = findGroup(l, groupId);
        if (!g) return l;
        if (from === to || from < 0 || to < 0) return l;
        const tabs = [...g.tabs];
        if (from >= tabs.length || to >= tabs.length) return l;
        const [m] = tabs.splice(from, 1);
        tabs.splice(to, 0, m);
        return updateGroup(l, groupId, { tabs });
      });
    },
    []
  );

  const newTab = useCallback(async (groupId?: string) => {
    const gid = groupId ?? stateRef.current.focusedId;
    try {
      const name = await api.createNote("md");
      setBuffers((prev) => [...prev, { name, content: "", dirty: false }]);
      setLayout((l) => {
        const g = findGroup(l, gid);
        if (!g) return l;
        return updateGroup(l, gid, { tabs: [...g.tabs, name], active: name });
      });
      setFocusedId(gid);
    } catch (e) {
      console.error("new tab failed", e);
    }
  }, []);

  const closeTab = useCallback(
    async (groupId: string, name: string) => {
      await flushSave(name);
      const s = stateRef.current;
      const g = findGroup(s.layout, groupId);
      if (!g) return;
      const idx = g.tabs.indexOf(name);
      const remaining = g.tabs.filter((t) => t !== name);

      if (remaining.length > 0) {
        const active =
          g.active === name
            ? remaining[Math.min(idx, remaining.length - 1)]
            : g.active;
        const next = updateGroup(s.layout, groupId, {
          tabs: remaining,
          active,
        });
        setLayout(next);
        setBuffers((prev) => gcBuffers(next, prev));
        return;
      }

      // Group empties out.
      if (allGroups(s.layout).length <= 1) {
        // Keep a single group alive with a fresh note.
        try {
          const fresh = await api.createNote("md");
          const next = updateGroup(s.layout, groupId, {
            tabs: [fresh],
            active: fresh,
          });
          setBuffers((prev) => [
            ...gcBuffers(next, prev),
            { name: fresh, content: "", dirty: false },
          ]);
          setLayout(next);
        } catch (e) {
          console.error("close tab failed", e);
        }
        return;
      }
      // Remove the now-empty pane and refocus.
      const next = removeGroup(s.layout, groupId)!;
      setLayout(next);
      setBuffers((prev) => gcBuffers(next, prev));
      setFocusedId(firstGroup(next).id);
    },
    [flushSave]
  );

  const closeGroup = useCallback(
    async (groupId: string) => {
      const s = stateRef.current;
      const g = findGroup(s.layout, groupId);
      if (!g || allGroups(s.layout).length <= 1) return;
      await Promise.all(g.tabs.map((n) => flushSave(n)));
      const next = removeGroup(s.layout, groupId)!;
      setLayout(next);
      setBuffers((prev) => gcBuffers(next, prev));
      setFocusedId(firstGroup(next).id);
    },
    [flushSave]
  );

  const splitFocused = useCallback((groupId: string, dir: "row" | "col") => {
    const s = stateRef.current;
    const g = findGroup(s.layout, groupId);
    if (!g || !g.active) return;
    // The new pane opens the same note — a second view / preview basis.
    const ng = makeGroup([g.active], g.active);
    const next = splitGroup(s.layout, groupId, dir, ng);
    setLayout(next);
    setFocusedId(ng.id);
  }, []);

  const onResize = useCallback(
    (splitId: string, index: number, delta: number) => {
      setLayout((l) => resizeSplit(l, splitId, index, delta));
    },
    []
  );

  const switchToIndex = useCallback((i: number) => {
    const s = stateRef.current;
    const g = findGroup(s.layout, s.focusedId) ?? firstGroup(s.layout);
    const name = g.tabs[i];
    if (name) setLayout((l) => updateGroup(l, g.id, { active: name }));
  }, []);

  const switchByOffset = useCallback((delta: number) => {
    const s = stateRef.current;
    const g = findGroup(s.layout, s.focusedId) ?? firstGroup(s.layout);
    if (g.tabs.length === 0) return;
    const i = g.tabs.findIndex((t) => t === g.active);
    const name = g.tabs[(i + delta + g.tabs.length) % g.tabs.length];
    setLayout((l) => updateGroup(l, g.id, { active: name }));
  }, []);

  const moveActiveTab = useCallback(
    (delta: number) => {
      const s = stateRef.current;
      const g = findGroup(s.layout, s.focusedId) ?? firstGroup(s.layout);
      const i = g.tabs.findIndex((t) => t === g.active);
      if (i < 0) return;
      reorderTab(g.id, i, i + delta);
    },
    [reorderTab]
  );

  const cycleTheme = useCallback(() => {
    setThemeId((id) => nextThemeId(id));
  }, []);

  // Open a note in the focused group (loading it if not already a buffer).
  const openNote = useCallback(async (name: string) => {
    const s = stateRef.current;
    const gid = s.focusedId;
    if (!s.buffers.some((b) => b.name === name)) {
      try {
        const content = await api.readNote(name);
        setBuffers((prev) =>
          prev.some((b) => b.name === name)
            ? prev
            : [...prev, { name, content, dirty: false }]
        );
      } catch (e) {
        console.error("open failed", name, e);
        return;
      }
    }
    setLayout((l) => {
      const g = findGroup(l, gid);
      if (!g) return l;
      const tabs = g.tabs.includes(name) ? g.tabs : [...g.tabs, name];
      return updateGroup(l, gid, { tabs, active: name });
    });
    setFocusedId(gid);
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);

  const startRename = useCallback((name?: string) => {
    const s = stateRef.current;
    const n =
      name ?? (findGroup(s.layout, s.focusedId) ?? firstGroup(s.layout)).active;
    if (n) setRenamingName(n);
  }, []);

  const commitRename = useCallback(
    async (oldName: string, raw: string) => {
      setRenamingName(null);
      const newName = raw.trim();
      if (!newName || newName === oldName) return;
      try {
        await flushSave(oldName);
        await api.renameNote(oldName, newName);
        const timers = saveTimers.current;
        const pending = timers.get(oldName);
        if (pending) {
          clearTimeout(pending);
          timers.delete(oldName);
        }
        setBuffers((prev) =>
          prev.map((b) => (b.name === oldName ? { ...b, name: newName } : b))
        );
        // Rename the note everywhere it's open across all groups.
        setLayout((l) => {
          const rename = (node: LayoutNode): LayoutNode =>
            node.kind === "group"
              ? {
                  ...node,
                  tabs: node.tabs.map((t) => (t === oldName ? newName : t)),
                  active: node.active === oldName ? newName : node.active,
                }
              : { ...node, children: node.children.map(rename) };
          return rename(l);
        });
      } catch (e) {
        console.error("rename failed", e);
      }
    },
    [flushSave]
  );

  // ---- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        e.stopPropagation();
        startRename();
        return;
      }
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();
      const fid = stateRef.current.focusedId;

      if (k === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      } else if (k === "\\" || k === "|") {
        // ⌘\ split right, ⌘⇧\ split down. Shift+\ is "|" on US layouts.
        e.preventDefault();
        splitFocused(fid, e.shiftKey ? "col" : "row");
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
        e.preventDefault(); // GitMenu handles quick commit & push
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
        newTab(fid);
      } else if (k === "w") {
        e.preventDefault();
        const g = findGroup(stateRef.current.layout, fid);
        if (g?.active) closeTab(fid, g.active);
      } else if (k === "s") {
        e.preventDefault();
        const g = findGroup(stateRef.current.layout, fid);
        if (g?.active) flushSave(g.active);
      } else if (e.shiftKey && (k === "]" || k === "}")) {
        e.preventDefault();
        moveActiveTab(1);
      } else if (e.shiftKey && (k === "[" || k === "{")) {
        e.preventDefault();
        moveActiveTab(-1);
      } else if (k === "]" || k === "}") {
        e.preventDefault();
        switchByOffset(1);
      } else if (k === "[" || k === "{") {
        e.preventDefault();
        switchByOffset(-1);
      } else if (k >= "1" && k <= "9") {
        e.preventDefault();
        switchToIndex(Number(k) - 1);
      }
      if (e.defaultPrevented) e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    newTab,
    closeTab,
    flushSave,
    cycleTheme,
    switchByOffset,
    switchToIndex,
    moveActiveTab,
    splitFocused,
    startRename,
    openPicker,
  ]);

  useEffect(() => {
    const onBlur = () => {
      for (const b of stateRef.current.buffers) {
        if (b.dirty) flushSave(b.name);
      }
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flushSave]);

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

  useEffect(() => {
    const p = listen("parker://open-settings", () => setSettingsOpen(true));
    return () => {
      p.then((un) => un());
    };
  }, []);

  // External-change reload — reload an open buffer when its file changes on
  // disk, but never over unsaved edits, and skip our own autosave writes.
  useEffect(() => {
    const timers = new Map<string, number>();
    const reload = async (name: string) => {
      const before = stateRef.current.buffers.find((b) => b.name === name);
      if (!before || before.dirty) return;
      let disk: string;
      try {
        disk = await api.readNote(name);
      } catch {
        return;
      }
      const now = stateRef.current.buffers.find((b) => b.name === name);
      if (!now || now.dirty || now.content === disk) return;
      setBuffers((prev) =>
        prev.map((b) =>
          b.name === name ? { ...b, content: disk, dirty: false } : b
        )
      );
    };
    const p = listen<string>("parker://note-changed", (e) => {
      const name = e.payload;
      if (!stateRef.current.buffers.some((b) => b.name === name)) return;
      const existing = timers.get(name);
      if (existing) clearTimeout(existing);
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

  const handlers: LayoutHandlers = {
    onFocus: focusGroup,
    onSelectTab: selectTab,
    onCloseTab: closeTab,
    onNewTab: newTab,
    onChange,
    onReorder: reorderTab,
    onStartRename: startRename,
    onCommitRename: commitRename,
    onCancelRename: () => setRenamingName(null),
    onSplit: splitFocused,
    onCloseGroup: closeGroup,
    onResize,
  };

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
            <span className="search-text">{activeName ?? "Search notes…"}</span>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3 a9 9 0 0 0 0 18 z" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings (Cmd+,)"
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="workspace">
        <LayoutView
          node={layout}
          focusedId={focusedGroup.id}
          buffers={buffers}
          theme={theme}
          gutterOn={gutterOn}
          wrapOn={wrapOn}
          renamingName={renamingName}
          multiGroup={multiGroup}
          h={handlers}
        />
      </div>

      <div className="statusbar">
        <span className="status-file">{activeName ?? ""}</span>
        <GitMenu onBeforeCommit={flushAll} />
        <span className="status-spacer" />
        <span className="status-count">
          {activeBuf
            ? `${activeBuf.content.split("\n").length} lines · ${
                activeBuf.content.length
              } chars`
            : ""}
        </span>
        <span className="status-dir" title={notesDir}>
          {prettyPath(notesDir, homeDir)}
        </span>
      </div>

      {pickerOpen && (
        <NotePicker
          openNames={buffers.map((b) => b.name)}
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
