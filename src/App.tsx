import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ListOrdered,
  WrapText,
  Palette,
  Settings as SettingsIcon,
  CircleQuestionMark,
  RefreshCw,
} from "lucide-react";
import { EditorView } from "@uiw/react-codemirror";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, emit } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { changedLines } from "./lib/linediff";
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
  resizeSplit,
} from "./lib/layout";
import type { Buffer, LayoutNode } from "./lib/layout";
import * as ws from "./lib/workspace";
import type { Workspace } from "./lib/workspace";
import { isMarkdown } from "./lib/markdown";
import { NotePicker } from "./components/NotePicker";
import { PerfMonitor } from "./components/PerfMonitor";
import { markTabSwitch, trackLatency } from "./lib/latency";
import { GitMenu } from "./components/GitMenu";
import { QuitConfirm } from "./components/QuitConfirm";
import { Settings } from "./components/Settings";
import { LayoutView } from "./components/LayoutView";
import type { LayoutHandlers } from "./components/LayoutView";
import "./App.css";

const AUTOSAVE_MS = 500;
const SESSION_MS = 400;

// Browser-style rungs rather than a fixed percentage: wider where the
// difference is hard to see, finer around 100% where people actually settle.
const ZOOM_STEPS = [
  0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];

export default function App() {
  const [buffers, setBuffers] = useState<Buffer[]>([]);
  const [layout, setLayout] = useState<LayoutNode>(() => makeGroup([], null));
  const [focusedId, setFocusedId] = useState<string>("");
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [notesDir, setNotesDir] = useState<string>("");
  const [homeDir, setHomeDir] = useState<string>("");
  const [ready, setReady] = useState(false);
  // Whether the saved session was read back in full. Nothing may be written
  // over the session file before this is true — see the startup effect.
  const sessionRestored = useRef(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  // ⌘Q / menu / tray asked to quit — waiting on the user's answer.
  const [quitAsk, setQuitAsk] = useState(false);
  // Interface zoom, browser-style: one factor over the whole webview. Rust
  // owns the value (it applies the saved one before the first paint), so this
  // is only the ladder and the current rung.
  const [zoom, setZoom] = useState(1);
  const [gutterOn, setGutterOn] = useState<boolean>(
    () => localStorage.getItem("parker.gutter") === "1"
  );
  const [wrapOn, setWrapOn] = useState<boolean>(
    () => localStorage.getItem("parker.wrap") !== "0"
  );
  // Coding ligatures in the editor (→ ⇒ ≠ …). Off by default: in prose a "->"
  // silently becoming an arrow is a surprise, not a feature.
  const [ligaturesOn, setLigaturesOn] = useState<boolean>(
    () => localStorage.getItem("parker.ligatures") === "1"
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

  // Bridge to the pure state machine in lib/workspace: read the current
  // workspace out of the ref, run the transition, apply only what changed.
  // Every rule about tabs and panes lives there; this hands it to React.
  const apply = useCallback(
    (step: (w: Workspace) => Workspace): Workspace => {
      const s = stateRef.current;
      const before: Workspace = {
        buffers: s.buffers,
        layout: s.layout,
        focusedId: s.focusedId,
      };
      const after = step(before);
      if (after.buffers !== before.buffers) setBuffers(after.buffers);
      if (after.layout !== before.layout) setLayout(after.layout);
      if (after.focusedId !== before.focusedId) setFocusedId(after.focusedId);
      return after;
    },
    []
  );

  // Focused group + its active buffer (drives the header/status bar).
  const groups = allGroups(layout);
  const focusedGroup = ws.focusedGroup({ buffers, layout, focusedId });
  const activeName = focusedGroup.active;
  const activeBuf = buffers.find((b) => b.name === activeName) ?? null;
  const multiGroup = groups.length > 1;
  const activeContent = activeBuf?.content ?? null;

  // Status-bar counts. Counting newlines by indexOf avoids split()'s
  // whole-document array allocation on every keystroke.
  const statusCounts = useMemo(() => {
    if (activeContent === null) return "";
    let lines = 1;
    for (
      let i = activeContent.indexOf("\n");
      i !== -1;
      i = activeContent.indexOf("\n", i + 1)
    )
      lines++;
    return `${lines} lines · ${activeContent.length} chars`;
  }, [activeContent]);

  // ---- Persistence helpers -------------------------------------------------

  const focusedActive = (s: typeof stateRef.current): string | null =>
    ws.activeName(s);

  const flushSave = useCallback(async (name: string) => {
    const timers = saveTimers.current;
    const pending = timers.get(name);
    if (pending) {
      clearTimeout(pending);
      timers.delete(name);
    }
    const buf = stateRef.current.buffers.find((b) => b.name === name);
    if (!buf) return;
    // A note with an open conflict is not autosaved: writing would answer the
    // question on the user's behalf, in favour of whoever was typing — which is
    // the silence this whole feature exists to break.
    if (buf.conflict) return;
    try {
      await api.writeNote(name, buf.content);
      setBuffers((prev) => ws.setError(ws.markSaved(prev, name), name, undefined));
    } catch (e) {
      // Until now this only reached the console: a note that could not be
      // written looked exactly like one that had been.
      console.error("save failed", name, e);
      setBuffers((prev) =>
        ws.setError(prev, name, `Could not save: ${e instanceof Error ? e.message : e}`)
      );
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
    if (!sessionRestored.current) return; // never overwrite a session we couldn't read
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

  // Startup reads files, and a file read is not guaranteed to come back. macOS
  // gates ~/Documents behind a consent prompt and blocks the open() until it is
  // answered; a network volume can stall the same way. None of that may leave
  // the user staring at a splash screen with no way forward, so the restore is
  // given a deadline and the app comes up regardless.
  const BOOT_MS = 8000;

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    const restore = async () => {
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
        // Only now is what's on screen a faithful picture of the session, so
        // only now may it be written back over the saved one.
        sessionRestored.current = true;
      } catch (e) {
        console.error("startup failed", e);
      }
    };
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, BOOT_MS));
    Promise.race([restore(), deadline]).then(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session whenever the open set / focus / theme changes.
  //
  // Gated on the restore having finished, not on `ready`: when it times out
  // the app comes up on an empty workspace, and saving that would wipe the
  // session it never managed to read.
  const openKey = buffers.map((b) => b.name).join(" ");
  useEffect(() => {
    if (sessionRestored.current) scheduleSessionSave();
  }, [openKey, focusedId, layout, themeId, scheduleSessionSave]);

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
      // To-do states. CANCEL isn't here: it is the third pole and already has
      // a role — --muted, set just above.
      "--todo-doing": theme.todo.doing,
      "--todo-pause": theme.todo.pause,
      "--todo-wait": theme.todo.wait,
      "--todo-attn": theme.todo.attn,
      "--todo-done": theme.todo.done,
      "--todo-fail": theme.todo.fail,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.mode = theme.mode;
    root.dataset.theme = theme.id;
    // Broadcast so the secondary windows (About, Help) follow the theme live.
    emit("parker://theme", theme.id).catch(() => {});
  }, [theme]);

  // Read back what Rust already applied, so ⌘= steps from the real rung
  // instead of from 100%.
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setZoom(s.zoom || 1))
      .catch(() => {});
  }, []);

  // The keyboard handler is registered once, so anything it calls has to read
  // the *current* zoom rather than the one that existed at first render — and
  // the ref is also what makes a burst of ⌘= walk up the ladder instead of
  // recomputing the same rung while the state catches up.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // CodeMirror lays the gutter out from measurements it takes of the DOM. A
  // zoom change rewrites those metrics underneath it, and it only re-measures
  // once its own observers notice the resize — which is a frame or two later,
  // and is exactly the gutter "arriving after" the text. Asking every live
  // editor to re-measure as part of the same gesture closes that gap. Two
  // frames because the native zoom lands after the call returns, so the first
  // frame can still read the old geometry.
  const remeasureEditors = useCallback(() => {
    const measure = () => {
      for (const el of document.querySelectorAll<HTMLElement>(".cm-editor")) {
        EditorView.findFromDOM(el)?.requestMeasure();
      }
    };
    requestAnimationFrame(() => {
      measure();
      requestAnimationFrame(measure);
    });
  }, []);

  const applyZoom = useCallback((next: number) => {
    zoomRef.current = next; // optimistic: the next keypress steps from here
    setZoom(next);
    // Rust clamps and persists; trust what it returns over what we asked for,
    // so the ladder can never walk past the end.
    api
      .setZoom(next)
      .then((applied) => {
        zoomRef.current = applied;
        setZoom(applied);
        remeasureEditors();
      })
      .catch(() => {});
  }, [remeasureEditors]);

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const cur = zoomRef.current;
      // Nearest rung, then move — so a zoom set elsewhere still steps sanely.
      const i = ZOOM_STEPS.reduce(
        (best, z, n) =>
          Math.abs(z - cur) < Math.abs(ZOOM_STEPS[best] - cur) ? n : best,
        0
      );
      const next =
        ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
      if (next !== cur) applyZoom(next);
    },
    [applyZoom]
  );
  useEffect(() => {
    localStorage.setItem("parker.gutter", gutterOn ? "1" : "0");
  }, [gutterOn]);
  useEffect(() => {
    localStorage.setItem("parker.wrap", wrapOn ? "1" : "0");
  }, [wrapOn]);
  useEffect(() => {
    localStorage.setItem("parker.ligatures", ligaturesOn ? "1" : "0");
  }, [ligaturesOn]);

  // ---- Buffer / tab actions -----------------------------------------------

  // Drop buffers no longer referenced by any group (after a close).
  const onChange = useCallback(
    (name: string, value: string) => {
      setBuffers((prev) => ws.editBuffer(prev, name, value));
      scheduleSave(name);
    },
    [scheduleSave]
  );

  const resolveConflict = useCallback(
    (name: string, take: "disk" | "mine") => {
      setBuffers((prev) => {
        const buf = prev.find((b) => b.name === name);
        const marks =
          take === "disk" && buf?.conflict
            ? changedLines(buf.content, buf.conflict.disk)
            : [];
        return ws.resolveConflict(prev, name, take, marks);
      });
      // Keeping yours leaves the buffer dirty on purpose: autosave, unblocked
      // now, is what writes the decision to disk.
      if (take === "mine") scheduleSave(name);
    },
    [scheduleSave]
  );

  const focusGroup = useCallback((id: string) => setFocusedId(id), []);

  const selectTab = useCallback(
    (groupId: string, name: string) => {
      markTabSwitch();
      apply((w) => ws.selectTab(w, groupId, name));
    },
    [apply]
  );

  const newTab = useCallback(
    async (groupId?: string) => {
      const gid = groupId ?? stateRef.current.focusedId;
      try {
        const name = await api.createNote("md");
        apply((w) => ws.openNote(w, gid, { name, content: "", dirty: false }));
      } catch (e) {
        console.error("new tab failed", e);
      }
    },
    [apply]
  );

  const closeTab = useCallback(
    async (groupId: string, name: string) => {
      await flushSave(name);
      const s = stateRef.current;
      // Ask the state machine what this close would do before doing it: if it
      // empties the only pane there has to be something left to edit, and
      // creating that note is the one part that touches disk. Doing it up
      // front keeps the whole close a single update — closing first and
      // filling in after would paint an empty pane in between.
      const { needsNote } = ws.closeTab(s, groupId, name);
      let fresh: string | null = null;
      if (needsNote) {
        try {
          fresh = await api.createNote("md");
        } catch (e) {
          console.error("close tab failed", e);
          return;
        }
      }
      apply((w) => {
        const { workspace, needsNote: empty } = ws.closeTab(w, groupId, name);
        return empty && fresh
          ? ws.openNote(workspace, groupId, { name: fresh, content: "", dirty: false })
          : workspace;
      });
    },
    [apply, flushSave]
  );

  const closeGroup = useCallback(
    async (groupId: string) => {
      const s = stateRef.current;
      const g = findGroup(s.layout, groupId);
      if (!g || allGroups(s.layout).length <= 1) return;
      await Promise.all(g.tabs.map((n) => flushSave(n)));
      apply((w) => ws.closePane(w, groupId));
    },
    [apply, flushSave]
  );

  const splitFocused = useCallback(
    (groupId: string, dir: "row" | "col") => {
      apply((w) => ws.splitPane(w, groupId, dir));
    },
    [apply]
  );

  // Toggle a pane between editor and markdown preview.
  const toggleMode = useCallback(
    (groupId: string) => {
      apply((w) => ws.toggleMode(w, groupId));
    },
    [apply]
  );

  // Open a live preview of the active note in a new pane to the right, leaving
  // the editor pane focused so you keep typing. (The one intentional mirror.)
  const previewToSide = useCallback(
    (groupId: string) => {
      const g = findGroup(stateRef.current.layout, groupId);
      if (!g || !g.active || !isMarkdown(g.active)) return;
      apply((w) => ws.previewToSide(w, groupId));
    },
    [apply]
  );

  // Merge this pane into its neighbouring sibling: the pane's tabs move over
  // and it collapses (like close, but keeping the tabs). The sibling survives.
  const mergeIntoParent = useCallback(
    (groupId: string) => {
      apply((w) => ws.mergePane(w, groupId));
    },
    [apply]
  );

  // Drop a dragged tab: reorder within a pane, or move it to another pane.
  const dropTab = useCallback(
    (source: { from: string; name: string }, toGroupId: string, toIndex: number) => {
      setTabDragging(false);
      apply((w) => ws.dropTab(w, source, toGroupId, toIndex));
    },
    [apply]
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

  const switchToIndex = useCallback(
    (i: number) => {
      apply((w) => ws.selectTabByIndex(w, i));
    },
    [apply]
  );

  // Move the active tab within its pane (⌃⌘[ / ⌃⌘]). Clamped at the ends.
  const moveTab = useCallback(
    (delta: number) => {
      apply((w) => ws.moveTab(w, delta));
    },
    [apply]
  );

  // Cycle focus through the panes (⌃⌥⌘[ / ⌃⌥⌘]). Focusing a group hands the
  // keyboard to its editor, since CodeMirror autoFocuses the focused pane.
  const focusPaneByOffset = useCallback(
    (delta: number) => {
      apply((w) => ws.focusPaneByOffset(w, delta));
    },
    [apply]
  );

  const switchByOffset = useCallback(
    (delta: number) => {
      apply((w) => ws.selectTabByOffset(w, delta));
    },
    [apply]
  );


  const cycleTheme = useCallback(() => {
    setThemeId((id) => nextThemeId(id));
  }, []);

  // Open a note in the focused group (loading it if not already a buffer).
  const openNote = useCallback(
    async (name: string) => {
      const s = stateRef.current;
      const gid = s.focusedId;
      const loaded = s.buffers.find((b) => b.name === name);
      let buffer = loaded;
      if (!buffer) {
        try {
          buffer = { name, content: await api.readNote(name), dirty: false };
        } catch (e) {
          console.error("open failed", name, e);
          return;
        }
      }
      apply((w) => ws.openNote(w, gid, buffer!));
    },
    [apply]
  );

  const openPicker = useCallback(() => setPickerOpen(true), []);

  // A note was moved to Trash from the picker: drop its buffer, cancel any
  // pending autosave (so it isn't recreated), and remove it from every pane.
  const onNoteDeleted = useCallback((name: string) => {
    const timers = saveTimers.current;
    const pending = timers.get(name);
    if (pending) {
      clearTimeout(pending);
      timers.delete(name);
    }
    apply((w) => ws.forgetNote(w, name));
  }, [apply]);

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
        apply((w) => ws.renameNote(w, oldName, newName));
      } catch (e) {
        console.error("rename failed", e);
      }
    },
    [apply, flushSave]
  );

  // ---- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();
      const fid = stateRef.current.focusedId;

      if (k === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      } else if (e.code === "Backslash" && !e.shiftKey) {
        // ⌃⌘\ split right, ⌃⌥⌘\ split down (matched by physical key so the
        // Option char doesn't matter). Ctrl isn't required — plain ⌘\ still
        // works — but it's the documented form because 1Password grabs ⌘\
        // globally for autofill, so that one never reaches us. ⌘⇧\ is left to
        // the editor — CodeMirror's "go to matching bracket".
        e.preventDefault();
        splitFocused(fid, e.altKey ? "col" : "row");
      } else if (
        e.ctrlKey &&
        (e.code === "BracketLeft" || e.code === "BracketRight")
      ) {
        // ⌃⌘[ / ⌃⌘] move the tab; add ⌥ to move focus between panes instead.
        e.preventDefault();
        const dir = e.code === "BracketRight" ? 1 : -1;
        if (e.altKey) focusPaneByOffset(dir);
        else moveTab(dir);
      } else if (k === "m" && e.shiftKey) {
        e.preventDefault();
        mergeIntoParent(fid); // ⌘⇧M — merge this pane into its neighbor
      } else if (k === "v" && e.shiftKey) {
        e.preventDefault();
        previewToSide(fid); // ⌘⇧V — markdown preview to the side
      } else if (k === "d" && e.shiftKey) {
        e.preventDefault();
        setPerfOpen((v) => !v); // ⌘⇧D — performance monitor overlay
      } else if (k === "t" && e.shiftKey) {
        e.preventDefault();
        cycleTheme(); // ⌘⇧T — next theme (the palette button's tooltip says so)
      } else if (k === "r" && e.shiftKey) {
        e.preventDefault();
        startRename();
      } else if (k === "s" && e.shiftKey) {
        e.preventDefault(); // GitMenu handles quick commit & push
      } else if (k === "=" || k === "+") {
        e.preventDefault();
        stepZoom(1);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        stepZoom(-1);
      } else if (k === "0") {
        e.preventDefault();
        applyZoom(1);
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
      } else if (e.shiftKey && (k === "]" || k === "}")) {
        e.preventDefault();
        switchByOffset(1); // ⌘⇧] next tab (Safari/Chrome style)
      } else if (e.shiftKey && (k === "[" || k === "{")) {
        e.preventDefault();
        switchByOffset(-1); // ⌘⇧[ previous tab
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
    moveTab,
    focusPaneByOffset,
    splitFocused,
    mergeIntoParent,
    previewToSide,
    startRename,
    openPicker,
    cycleTheme,
  ]);

  // Measure keydown → painted frame for real typing, all the time: the cost
  // is one listener, and it means the ⌘⇧D overlay always has honest numbers.
  useEffect(() => trackLatency(), []);

  useEffect(() => {
    const onBlur = () => {
      for (const b of stateRef.current.buffers) {
        if (b.dirty) flushSave(b.name);
      }
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flushSave]);

  // A tab dropped onto another pane is unmounted at the source, and a removed
  // element never fires dragend — which used to leave `tabDragging` stuck on,
  // covering every pane with an invisible drop catcher that swallowed clicks
  // and keystrokes. The window hears the end of the drag either way.
  useEffect(() => {
    const clear = () => setTabDragging(false);
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("blur", clear);
    };
  }, []);

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

  // A quit the user asked for gets a question first. The silent path above is
  // still the one that actually leaves — this only decides whether to take it.
  useEffect(() => {
    const p = listen("parker://confirm-quit", () => setQuitAsk(true));
    return () => {
      p.then((un) => un());
    };
  }, []);

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
      if (!before) return;
      let disk: string;
      try {
        disk = await api.readNote(name);
      } catch (e) {
        setBuffers((prev) =>
          ws.setError(prev, name, `Could not read: ${e instanceof Error ? e.message : e}`)
        );
        return;
      }
      const now = stateRef.current.buffers.find((b) => b.name === name);
      if (!now || now.content === disk) return;
      if (now.dirty) {
        // Two versions exist and only the user can choose. Parker used to keep
        // theirs in silence and let autosave write it over the other one —
        // which, when the change came from a git pull, meant the next sync
        // committed the overwrite too.
        // Always the latest disk text, even if a conflict is already open: the
        // file can change again while the bar sits there, and "Use disk
        // version" must not hand back a version that no longer exists.
        setBuffers((prev) => ws.markConflict(prev, name, disk));
        return;
      }
      setBuffers((prev) =>
        ws.reloadBuffer(prev, name, disk, changedLines(now.content, disk))
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

  // Notes reloaded from disk that the user has not typed over yet. The tab
  // marks say which; this says that it happened at all, for when the tab strip
  // is scrolled or the note isn't open in this pane.
  const reloaded = ws.unseenChanges(buffers);

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
    onResolveConflict: resolveConflict,
    onResize,
    onEqualize,
  };

  return (
    <div className={"parker" + (ligaturesOn ? " ligatures" : "")}>
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
        {reloaded.length > 0 && (
          <span
            className="status-reloaded"
            title={`Reloaded from disk: ${reloaded.join(", ")}`}
          >
            <RefreshCw size={11} strokeWidth={2.5} aria-hidden />
            {reloaded.length} {reloaded.length === 1 ? "note" : "notes"} reloaded
          </span>
        )}
        <GitMenu onBeforeCommit={flushAll} />
        <span className="status-spacer" />
        <span className="status-count">{statusCounts}</span>
        <span className="status-dir" title={notesDir}>
          {prettyPath(notesDir, homeDir)}
        </span>
        <button
          className="status-help"
          onClick={() => api.openHelp()}
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
          onDeleted={onNoteDeleted}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {settingsOpen && (
        <Settings
          homeDir={homeDir}
          ligaturesOn={ligaturesOn}
          onToggleLigatures={() => setLigaturesOn((v) => !v)}
          onClose={() => setSettingsOpen(false)}
          onNotesDirChange={(dir) => setNotesDir(dir)}
        />
      )}

      {quitAsk && (
        <QuitConfirm
          onCancel={() => setQuitAsk(false)}
          onQuit={async () => {
            setQuitAsk(false);
            try {
              await flushAll();
            } finally {
              await api.quit().catch(() => {});
            }
          }}
        />
      )}

      {perfOpen && (
        <PerfMonitor
          buffers={buffers}
          theme={theme}
          wrapOn={wrapOn}
          onClose={() => setPerfOpen(false)}
        />
      )}

    </div>
  );
}
