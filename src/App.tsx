import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  ListOrdered,
  WrapText,
  Palette,
  Settings as SettingsIcon,
  CircleQuestionMark,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { prettyPath } from "./lib/path";
import { DEFAULT_THEME_ID, nextThemeId, themeById } from "./lib/themes";
import {
  allGroups,
  allTabNames,
  asLayout,
  findGroup,
  firstGroup,
  centerDivider,
  makeGroup,
  pruneLayout,
  removeGroup,
  resizeSplit,
  siblingGroupId,
  splitGroup,
  updateGroup,
} from "./lib/layout";
import type { Buffer, LayoutNode } from "./lib/layout";
import { isMarkdown } from "./lib/markdown";
import { NotePicker } from "./components/NotePicker";
import { GitMenu } from "./components/GitMenu";
import { Settings } from "./components/Settings";
import { Shortcuts } from "./components/Shortcuts";
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
  const [helpOpen, setHelpOpen] = useState(false);
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
  // Option (⌥) held → the pane's split buttons become a merge (unsplit) button.
  const [altHeld, setAltHeld] = useState(false);
  // True while a tab is being dragged — lets every pane show a full-body drop
  // zone (above the editor) so a tab can be dropped anywhere on a pane.
  const [tabDragging, setTabDragging] = useState(false);

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
        layout: s.layout,
        focused: s.focusedId,
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
          layout: s.layout,
          focused: s.focusedId,
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

        // Restore the split layout if we saved one and it still holds notes;
        // otherwise fall back to a single pane with the open notes.
        const valid = new Set(restored.map((b) => b.name));
        const saved = session.layout ? asLayout(session.layout) : null;
        const pruned = saved ? pruneLayout(saved, valid) : null;

        let root: LayoutNode;
        let focused: string;
        if (pruned && allTabNames(pruned).length > 0) {
          root = pruned;
          focused =
            session.focused && findGroup(pruned, session.focused)
              ? session.focused
              : firstGroup(pruned).id;
        } else {
          const g = makeGroup(
            restored.map((b) => b.name),
            active
          );
          root = g;
          focused = g.id;
        }
        setBuffers(restored);
        setLayout(root);
        setFocusedId(focused);
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
    setLayout((l) => {
      const g = findGroup(l, groupId);
      // Switching to a different tab returns the pane to the editor, so preview
      // is a deliberate view of the current note rather than a sticky mode.
      return updateGroup(
        l,
        groupId,
        g && g.active !== name
          ? { active: name, mode: "edit" }
          : { active: name }
      );
    });
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
        return updateGroup(l, gid, {
          tabs: [...g.tabs, name],
          active: name,
          mode: "edit",
        });
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
    if (!g) return;
    let base = s.layout;
    let ng;
    if (g.active) {
      // The selected tab moves into the new pane — even if it was the only
      // one, leaving the original empty. No duplication.
      const active = g.active;
      const idx = g.tabs.indexOf(active);
      const remaining = g.tabs.filter((t) => t !== active);
      base = updateGroup(s.layout, groupId, {
        tabs: remaining,
        active: remaining.length
          ? remaining[Math.min(idx, remaining.length - 1)]
          : null,
      });
      ng = makeGroup([active], active);
    } else {
      // No selection (already an empty pane) → a fresh empty pane.
      ng = makeGroup([], null);
    }
    const next = splitGroup(base, groupId, dir, ng);
    setLayout(next);
    setFocusedId(ng.id);
  }, []);

  // Toggle a pane between editor and markdown preview.
  const toggleMode = useCallback((groupId: string) => {
    setLayout((l) => {
      const g = findGroup(l, groupId);
      if (!g) return l;
      return updateGroup(l, groupId, {
        mode: g.mode === "preview" ? "edit" : "preview",
      });
    });
  }, []);

  // Open a live preview of the active note in a new pane to the right, leaving
  // the editor pane focused so you keep typing. (The one intentional mirror.)
  const previewToSide = useCallback((groupId: string) => {
    const s = stateRef.current;
    const g = findGroup(s.layout, groupId);
    if (!g || !g.active || !isMarkdown(g.active)) return;
    const ng = makeGroup([g.active], g.active, "preview");
    setLayout(splitGroup(s.layout, groupId, "row", ng));
    setFocusedId(groupId);
  }, []);

  // Merge this pane into its neighbouring sibling: the pane's tabs move over
  // and it collapses (like close, but keeping the tabs). The sibling survives.
  const mergeIntoParent = useCallback((groupId: string) => {
    const s = stateRef.current;
    const g = findGroup(s.layout, groupId);
    const sibId = g ? siblingGroupId(s.layout, groupId) : null;
    const sib = sibId ? findGroup(s.layout, sibId) : null;
    if (!g || !sibId || !sib) return;
    const mergedTabs = [
      ...sib.tabs,
      ...g.tabs.filter((t) => !sib.tabs.includes(t)),
    ];
    let next = updateGroup(s.layout, sibId, {
      tabs: mergedTabs,
      active: sib.active ?? g.active,
    });
    next = removeGroup(next, groupId)!;
    setLayout(next);
    setBuffers((prev) => gcBuffers(next, prev));
    setFocusedId(sibId);
  }, []);

  // Drop a dragged tab: reorder within a pane, or move it to another pane.
  const dropTab = useCallback(
    (source: { from: string; name: string }, toGroupId: string, toIndex: number) => {
      const s = stateRef.current;
      const { from, name } = source;
      if (from === toGroupId) {
        const g = findGroup(s.layout, toGroupId);
        if (!g) return;
        const fromIdx = g.tabs.indexOf(name);
        if (fromIdx < 0) return;
        const tabs = g.tabs.filter((t) => t !== name);
        const at = Math.min(Math.max(toIndex, 0), tabs.length);
        tabs.splice(at, 0, name);
        setLayout((l) => updateGroup(l, toGroupId, { tabs }));
        return;
      }
      const src = findGroup(s.layout, from);
      const dst = findGroup(s.layout, toGroupId);
      if (!src || !dst) return;
      const srcTabs = src.tabs.filter((t) => t !== name);
      const srcActive =
        src.active === name
          ? srcTabs[Math.min(src.tabs.indexOf(name), srcTabs.length - 1)] ?? null
          : src.active;
      const dstTabs = dst.tabs.filter((t) => t !== name);
      const at = Math.min(Math.max(toIndex, 0), dstTabs.length);
      dstTabs.splice(at, 0, name);
      let next = updateGroup(s.layout, toGroupId, {
        tabs: dstTabs,
        active: name,
      });
      if (srcTabs.length === 0) {
        next = removeGroup(next, from)!; // source emptied → collapse it
      } else {
        next = updateGroup(next, from, { tabs: srcTabs, active: srcActive });
      }
      setLayout(next);
      setFocusedId(toGroupId);
    },
    []
  );

  const onResize = useCallback(
    (splitId: string, index: number, delta: number) => {
      setLayout((l) => resizeSplit(l, splitId, index, delta));
    },
    []
  );

  const onEqualize = useCallback((splitId: string, index: number) => {
    setLayout((l) => centerDivider(l, splitId, index));
  }, []);

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
      return updateGroup(l, gid, { tabs, active: name, mode: "edit" });
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
      // ⌃Tab / ⌃⇧Tab cycle tabs (Chrome / VS Code style, layout-independent).
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        switchByOffset(e.shiftKey ? -1 : 1);
        return;
      }
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();
      const fid = stateRef.current.focusedId;

      if (k === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      } else if (e.code === "Backslash" && !e.shiftKey) {
        // ⌘\ split right, ⌘⌥\ split down (matched by physical key so the
        // Option char doesn't matter). ⌘⇧\ is left to the editor — CodeMirror's
        // "go to matching bracket".
        e.preventDefault();
        splitFocused(fid, e.altKey ? "col" : "row");
      } else if (k === "m" && e.shiftKey) {
        e.preventDefault();
        mergeIntoParent(fid); // ⌘⇧M — merge this pane into its neighbor
      } else if (k === "v" && e.shiftKey) {
        e.preventDefault();
        previewToSide(fid); // ⌘⇧V — markdown preview to the side
      } else if (k === "r" && e.shiftKey) {
        e.preventDefault();
        startRename();
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
      } else if (k === "n") {
        e.preventDefault();
        newTab(fid); // ⌘N — new note
      } else if (k === "w") {
        e.preventDefault();
        const g = findGroup(stateRef.current.layout, fid);
        if (g?.active) closeTab(fid, g.active);
      } else if (k === "s") {
        e.preventDefault();
        const g = findGroup(stateRef.current.layout, fid);
        if (g?.active) flushSave(g.active);
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        switchByOffset(1); // ⌘⌥→ next tab (frees ⌘] for editor indent)
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        switchByOffset(-1); // ⌘⌥← previous tab
      } else if (e.shiftKey && (k === "]" || k === "}")) {
        e.preventDefault();
        moveActiveTab(1); // ⌘⇧] move tab right
      } else if (e.shiftKey && (k === "[" || k === "{")) {
        e.preventDefault();
        moveActiveTab(-1); // ⌘⇧[ move tab left
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
    switchByOffset,
    switchToIndex,
    moveActiveTab,
    splitFocused,
    mergeIntoParent,
    previewToSide,
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

  // Track Option so the pane buttons can flip to "merge" while it's held.
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setAltHeld(e.altKey);
    const clear = () => setAltHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

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

  useEffect(() => {
    const p = listen("parker://open-help", () => setHelpOpen(true));
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
    onStartRename: startRename,
    onCommitRename: commitRename,
    onCancelRename: () => setRenamingName(null),
    onSplit: splitFocused,
    onMerge: mergeIntoParent,
    onToggleMode: toggleMode,
    onPreviewToSide: previewToSide,
    onDropTab: dropTab,
    onTabDragStart: () => setTabDragging(true),
    onTabDragEnd: () => setTabDragging(false),
    onCloseGroup: closeGroup,
    onResize,
    onEqualize,
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
            <Search className="search-icon" size={13} strokeWidth={2} aria-hidden="true" />
            <span className="search-text">{activeName ?? "Search notes…"}</span>
            <span className="search-kbd">⌘O</span>
          </button>
        </div>
        <div className="tb-right" data-tauri-drag-region>
          <button
            className={"icon-btn" + (gutterOn ? " on" : "")}
            onClick={() => setGutterOn((v) => !v)}
            title="Line numbers"
            aria-label="Toggle line numbers"
            aria-pressed={gutterOn}
          >
            <ListOrdered size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            className={"icon-btn" + (wrapOn ? " on" : "")}
            onClick={() => setWrapOn((v) => !v)}
            title="Wrap long lines"
            aria-label="Toggle line wrap"
            aria-pressed={wrapOn}
          >
            <WrapText size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            className="icon-btn"
            onClick={cycleTheme}
            onDoubleClick={() => setThemeId(DEFAULT_THEME_ID)}
            title={`Theme: ${theme.label} — cycle (Cmd+Shift+T) · double-click to reset`}
            aria-label="Cycle theme"
          >
            <Palette size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings (Cmd+,)"
            aria-label="Settings"
          >
            <SettingsIcon size={16} strokeWidth={1.8} aria-hidden="true" />
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
          altHeld={altHeld}
          dragging={tabDragging}
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
        <button
          className="status-help"
          onClick={() => setHelpOpen(true)}
          title="Keyboard shortcuts (Cmd+K)"
          aria-label="Keyboard shortcuts"
        >
          <CircleQuestionMark size={16} strokeWidth={2} aria-hidden="true" />
        </button>
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

      {helpOpen && <Shortcuts onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
