import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ListOrdered,
  WrapText,
  Palette,
  Link2,
  Settings as SettingsIcon,
  CircleQuestionMark,
  RefreshCw,
} from "lucide-react";
import { EditorView } from "@uiw/react-codemirror";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, emit } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import { changedLines } from "./lib/linediff";
import { changeRecord, whitespaceOnly } from "./lib/external-change";
import { prettyPath } from "./lib/path";
import { displayName, droppedExternals, isExternal, renamedIn } from "./lib/external";
import { isFirstLaunch } from "./lib/session";
import { PathLabel } from "./components/PathLabel";
import { DEFAULT_THEME_ID, nextThemeId, themeById } from "./lib/themes";
import { alpha } from "./lib/palette";
import { textWidthOf } from "./lib/text-width";
import type { TextWidth } from "./lib/text-width";
import {
  allGroups,
  allTabNames,
  asLayout,
  findGroup,
  firstGroup,
  centerDivider,
  isPreviewTab,
  makeGroup,
  noteOf,
  previewTab,
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
import { LayoutView } from "./components/LayoutView";
import type { LayoutHandlers } from "./components/LayoutView";
import { FirstRun } from "./components/FirstRun";
import type { FirstRunBackend } from "./components/FirstRun";
import { DEFAULT_IMAGE_MODE, imageModeOf } from "./lib/images";
import type { ImageMode } from "./lib/images";
import "./App.css";

// Events Rust addresses to one window (quit, pop-out, a note handed over…)
// are listened to on this window. The app-wide `listen` would hear them
// whichever window they were meant for — Tauri's plain emit reaches every
// listener, and a labeled target only tells them apart on this side.
const thisWindow = getCurrentWebviewWindow();

const AUTOSAVE_MS = 500;
const SESSION_MS = 400;

// Browser-style rungs rather than a fixed percentage: wider where the
// difference is hard to see, finer around 100% where people actually settle.
const ZOOM_STEPS = [
  0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];

// A buffer's text comes and goes through one of two doors in Rust, and its
// name says which: a note by bare name, a file from outside the folder by its
// absolute path. Nothing below this line needs to know the difference.
/** How long a note may take to arrive from iCloud before the tab says it
 *  may not be coming. */
const CLOUD_PATIENCE_MS = 20_000;
const readText = (name: string) =>
  isExternal(name) ? api.readFile(name) : api.readNote(name);
/** A note read into a buffer — or, when iCloud has it and this Mac doesn't,
 *  a buffer that waits for it (Rust is already fetching). Other failures
 *  still throw. */
async function readOrCloud(name: string): Promise<Buffer> {
  try {
    const text = await readText(name);
    return { name, content: text, disk: text, dirty: false };
  } catch (e) {
    if (ws.readFailure(e instanceof Error ? e.message : String(e)) === "cloud") {
      return ws.cloudBuffer(name);
    }
    throw e;
  }
}
/** The welcome screen's commands, the real ones. */
const firstRunBackend: FirstRunBackend = {
  lookForNotes: api.lookForNotes,
  inspect: api.inspectFolder,
  icloud: api.icloudState,
  pickFolder: api.pickNotesDir,
  openSystemSettings: api.openSystemSettings,
  finish: api.finishFirstRun,
};

const writeText = (name: string, content: string) =>
  isExternal(name) ? api.writeFile(name, content) : api.writeNote(name, content);

/** A note window: the editor locked to one note. Everything the main window
 *  does with tabs, panes and the session is switched off; the window's own
 *  controls (pin, back to main) are switched on. */
export interface NoteWindowProps {
  name: string;
  theme: string | null;
  onTop: boolean;
  /** Open on the note's preview — the tab was a preview when it came out. */
  preview: boolean;
}

export default function App({
  noteWindow,
  initialTheme,
}: { noteWindow?: NoteWindowProps; initialTheme?: string | null } = {}) {
  // One note, one window: no session of its own, no second tab, no split.
  const single = !!noteWindow;
  const [buffers, setBuffers] = useState<Buffer[]>([]);
  const [layout, setLayout] = useState<LayoutNode>(() => makeGroup([], null));
  const [focusedId, setFocusedId] = useState<string>("");
  // Rust puts the theme in force in every window's URL — the main window's
  // too — so the first frame is already in it, not in the default.
  const [themeId, setThemeId] = useState<string>(noteWindow?.theme || initialTheme || DEFAULT_THEME_ID);
  // Pinned above the other windows (note windows only).
  const [onTop, setOnTop] = useState<boolean>(noteWindow?.onTop ?? false);
  // The theme is broadcast to the other windows only once this one knows
  // its own: a note window from its URL, the main window from the session.
  // Before that the default would be announced, and the others would follow.
  const themeSettled = useRef(single);
  const [notesDir, setNotesDir] = useState<string>("");
  // The Mac's very first open: the welcome screen instead of the workspace,
  // until a folder is chosen (FirstRun). Nothing reads the folder before.
  const [firstRun, setFirstRun] = useState(false);
  const firstNote = useRef<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [ready, setReady] = useState(false);
  // Whether the saved session was read back in full. Nothing may be written
  // over the session file before this is true — see the startup effect.
  const sessionRestored = useRef(false);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Mirrored for the window-level key handler, which is registered once and
  // runs in the capture phase — before the picker's own input sees the key.
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;
  const [perfOpen, setPerfOpen] = useState(false);
  // ⌘Q / menu / tray asked to quit — waiting on the user's answer.
  const [quitAsk, setQuitAsk] = useState(false);
  // Interface zoom, browser-style: one factor over the whole webview. Rust
  // owns the value (it applies the saved one before the first paint), so this
  // is only the ladder and the current rung.
  const [zoom, setZoom] = useState(1);
  // Editor toggles. Rust owns the saved values (settings.json, alongside git
  // and zoom); these start at the defaults and take the saved ones on load.
  // They used to live in localStorage, which macOS keys by bundle identifier —
  // the 1.0.2 identifier change is what moved them.
  const [gutterOn, setGutterOn] = useState<boolean>(false);
  const [wrapOn, setWrapOn] = useState<boolean>(true);
  // Coding ligatures in the editor (→ ⇒ ≠ …). Off by default: in prose a "->"
  // silently becoming an arrow is a surprise, not a feature.
  const [ligaturesOn, setLigaturesOn] = useState<boolean>(false);
  const [textWidth, setTextWidth] = useState<TextWidth>(100);
  // The side-by-side preview follows the editor — cursor, selection, scroll
  // and the amber marks. A global switch, like the gutter and wrapping.
  const [previewSync, setPreviewSync] = useState<boolean>(true);
  const [previewImages, setPreviewImages] = useState<ImageMode>(DEFAULT_IMAGE_MODE);
  // Open notes that are symlinks → the file each points at (tab tooltip, and
  // the rename warning). Asked again whenever the open notes change.
  const [links, setLinks] = useState<Record<string, string>>({});
  // Until the saved toggles have been read, a flip must not be written back —
  // it would overwrite the file with the defaults before they were loaded.
  const prefsLoaded = useRef(false);
  // Option (⌥) held → the pane's split buttons become a merge (unsplit) button.
  const [altHeld, setAltHeld] = useState(false);
  // True while a tab is being dragged — lets every pane show a full-body drop
  // zone (above the editor) so a tab can be dropped anywhere on a pane.
  const [tabDragging, setTabDragging] = useState(false);
  // True while a file from the Finder is being dragged over the window. The
  // panes show the same drop ring as for a tab, in the outside-folder colour,
  // and the last pane the file crossed is where it opens.
  const [fileDragging, setFileDragging] = useState(false);
  // Where it is: the pane, and the tab it is over if any — the file takes
  // that tab's place in the strip, as a dragged tab would.
  const fileDrop = useRef<{ group: string; index?: number } | null>(null);

  // Mirror state into a ref so global handlers never read stale values.
  const stateRef = useRef({ buffers, layout, focusedId, themeId });
  stateRef.current = { buffers, layout, focusedId, themeId };

  const saveTimers = useRef<Map<string, number>>(new Map());
  // What Parker itself last wrote into each note, and a count of those writes.
  // Recorded the instant the write returns — before React has re-rendered the
  // new baseline, and whatever path did the writing — so the watcher can tell
  // Parker's own echo from somebody else's edit.
  const lastWrite = useRef<Map<string, { text: string; seq: number }>>(new Map());
  const sessionTimer = useRef<number | null>(null);
  const didInit = useRef(false);
  // The restore held back by a first run, run when the welcome is done.
  const restoreAfterFirstRun = useRef<(() => Promise<void>) | null>(null);

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
      if (after.buffers !== before.buffers) {
        setBuffers(after.buffers);
        // A file from outside the folder that no pane shows any more is let
        // go of on the Rust side too: its path stops being addressable and
        // its folder stops being watched.
        for (const path of droppedExternals(before.buffers, after.buffers))
          api.closeFile(path).catch(() => {});
      }
      if (after.layout !== before.layout) setLayout(after.layout);
      if (after.focusedId !== before.focusedId) setFocusedId(after.focusedId);
      return after;
    },
    []
  );

  // Focused group + its active buffer (drives the header/status bar).
  const groups = allGroups(layout);
  const focusedGroup = ws.focusedGroup({ buffers, layout, focusedId });
  // The note in front of the focused pane — whether its editor or its preview.
  const activeName = focusedGroup.active ? noteOf(focusedGroup.active) : null;
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
    // A note with an open conflict is not autosaved: writing would answer the
    // question on the user's behalf, in favour of whoever was typing — which is
    // the silence this whole feature exists to break. Nor is a note whose file
    // is gone: the write would bring back what the user just threw away.
    if (!ws.canAutosave(buf)) return;
    try {
      const written = buf.content;
      await writeText(name, written);
      const seq = (lastWrite.current.get(name)?.seq ?? 0) + 1;
      lastWrite.current.set(name, { text: written, seq });
      setBuffers((prev) => ws.setError(ws.markSaved(prev, name, written), name, undefined));
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

  // Write every unsaved note now — on the way to hiding the window, quitting,
  // or committing. It goes through flushSave rather than writing directly: a
  // write nobody recorded looks exactly like an outside edit, and the change
  // event it fires opened a conflict against Parker's own save. flushSave also
  // leaves a note with an open conflict alone, which a blanket write answered
  // on the user's behalf.
  const flushAll = useCallback(async () => {
    const s = stateRef.current;
    await Promise.all(s.buffers.filter((b) => b.dirty).map((b) => flushSave(b.name)));
    if (!sessionRestored.current) return; // never overwrite a session we couldn't read
    await api
      .saveSession({
        open: s.buffers.map((b) => b.name),
        active: focusedActive(s),
        theme: s.themeId,
        theme_bg: themeById(s.themeId).ui.editorBg,
        layout: s.layout,
        focused: s.focusedId,
      })
      .catch(() => {});
  }, [flushSave]);

  const scheduleSessionSave = useCallback(() => {
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    sessionTimer.current = window.setTimeout(() => {
      const s = stateRef.current;
      api
        .saveSession({
          open: s.buffers.map((b) => b.name),
          active: focusedActive(s),
          theme: s.themeId,
          theme_bg: themeById(s.themeId).ui.editorBg,
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
    // A note window has no session to restore: it shows the note it was
    // opened for, and nothing it does is written to the session file — Rust
    // keeps the list of note windows itself. A note that cannot be read is a
    // window with nothing to show, so it closes.
    const openSingle = async (name: string) => {
      try {
        setHomeDir(await api.homeDirPath());
        setNotesDir(await api.notesDirPath());
        const buffer = await readOrCloud(name);
        const tab = noteWindow?.preview ? previewTab(name) : name;
        const g = makeGroup([tab], tab);
        setBuffers([buffer]);
        setLayout(g);
        setFocusedId(g.id);
      } catch (e) {
        console.error("note window: open failed", name, e);
        api.closeNoteWindow().catch(() => {});
      }
    };
    const restore = async () => {
      try {
        setHomeDir(await api.homeDirPath());
        setNotesDir(await api.notesDirPath());
        const session = await api.loadSession();

        // All at once, not one after another: one slow read no longer holds
        // up the rest. A note iCloud evicted comes back at once as a tab that
        // is downloading; one deleted or renamed outside the app is skipped.
        const names = session.open ?? [];
        const reads = await Promise.allSettled(names.map((n) => readText(n)));
        const restored: Buffer[] = [];
        reads.forEach((r, i) => {
          const name = names[i];
          if (r.status === "fulfilled") {
            restored.push({ name, content: r.value, disk: r.value, dirty: false });
          } else if (ws.readFailure(String(r.reason)) === "cloud") {
            restored.push(ws.cloudBuffer(name));
          }
        });
        // A first launch gets a note to type into. A session that merely has
        // nothing open — the last tab was closed, or every note it listed is
        // gone — comes back as the empty pane it was; making a note here is
        // how Untitled files used to pile up on every launch.
        if (restored.length === 0 && firstNote.current) {
          // Just chosen on the welcome screen: its Welcome note.
          const name = firstNote.current;
          firstNote.current = null;
          const text = await readText(name).catch(() => "");
          restored.push({ name, content: text, disk: text, dirty: false });
        } else if (restored.length === 0 && isFirstLaunch(session)) {
          const name = await api.createNote("md");
          restored.push({ name, content: "", disk: "", dirty: false });
        }
        const active =
          session.active && restored.some((b) => b.name === session.active)
            ? session.active
            : restored[0]?.name ?? null;

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
        themeSettled.current = true;
        // Only now is what's on screen a faithful picture of the session, so
        // only now may it be written back over the saved one.
        sessionRestored.current = true;
      } catch (e) {
        console.error("startup failed", e);
      }
    };
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, BOOT_MS));
    const start = async () => {
      // A first run shows the welcome screen, and restores only once it's done.
      if (!noteWindow && (await api.isFirstRun().catch(() => false))) {
        restoreAfterFirstRun.current = restore;
        setFirstRun(true);
        return;
      }
      await (noteWindow ? openSingle(noteWindow.name) : restore());
    };
    Promise.race([start(), deadline]).then(() => setReady(true));
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

  useEffect(() => {
    const names = buffers.map((b) => b.name).filter((n) => !isExternal(n));
    if (!names.length) return setLinks({});
    api.noteLinks(names).then(setLinks).catch(() => setLinks({}));
    // openKey is the list of names; the buffers' contents don't matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  // Reflect the theme's named UI roles as CSS variables on the root element —
  // before the frame paints (a layout effect), so no frame is drawn without.
  useLayoutEffect(() => {
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
      // Priority of an open to-do: the empty box's border, green → red.
      "--priority-base": theme.priority.base,
      "--priority-low": theme.priority.low,
      "--priority-mid": theme.priority.mid,
      "--priority-high": theme.priority.high,
      // The markdown marks the stylesheet dresses (themes.ts monoStyles).
      "--md-bold": theme.syntax.bold,
      "--md-italic": theme.syntax.italic,
      "--md-bold-italic": theme.syntax.boldItalic,
      "--md-code": theme.syntax.inlineCode,
      "--md-code-bg": alpha(theme.syntax.inlineCode, 0.14),
      "--md-link": theme.syntax.link,
      "--md-url": theme.syntax.url,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.mode = theme.mode;
    root.dataset.theme = theme.id;
    // Broadcast so every other window — About, Help, the other editor
    // windows — follows the theme live, and tell Rust, so the next window it
    // opens is born in it and the open ones take its colour underneath.
    if (themeSettled.current) {
      emit("parker://theme", theme.id).catch(() => {});
      api.setTheme(theme.id, u.editorBg).catch(() => {});
    }
  }, [theme]);

  // The theme is one for the app: a change made in any window reaches the
  // others here. Our own broadcast comes back too, and changes nothing.
  useEffect(() => {
    const p = listen<string>("parker://theme", (e) => {
      themeSettled.current = true;
      setThemeId((cur) => (cur === e.payload ? cur : e.payload));
    });
    return () => {
      p.then((un) => un());
    };
  }, []);

  // Likewise the editor toggles: Rust writes settings.json and tells every
  // window. The window that flipped the switch already holds the value.
  useEffect(() => {
    const p = listen<{
      editor_gutter: boolean;
      editor_wrap: boolean;
      editor_ligatures: boolean;
      editor_width: number;
      preview_sync: boolean;
      preview_images?: string;
    }>("parker://prefs", (e) => {
      const s = e.payload;
      setGutterOn(s.editor_gutter);
      setWrapOn(s.editor_wrap);
      setLigaturesOn(s.editor_ligatures);
      setTextWidth(textWidthOf(s.editor_width));
      setPreviewSync(s.preview_sync);
      setPreviewImages(imageModeOf(s.preview_images));
    });
    return () => {
      p.then((un) => un());
    };
  }, []);

  // Read back what Rust already applied, so ⌘= steps from the real rung
  // instead of from 100% — and the editor toggles along with it.
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setZoom(s.zoom || 1);
        setGutterOn(s.editor_gutter);
        setWrapOn(s.editor_wrap);
        setLigaturesOn(s.editor_ligatures);
        setTextWidth(textWidthOf(s.editor_width));
        setPreviewSync(s.preview_sync);
        setPreviewImages(imageModeOf(s.preview_images));
        prefsLoaded.current = true;
      })
      .catch(() => {});
  }, []);

  // The keyboard handler is registered once, so anything it calls has to read
  // the *current* zoom rather than the one that existed at first render — and
  // the ref is also what makes a burst of ⌘= walk up the ladder instead of
  // recomputing the same rung while the state catches up.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Zoom is applied to every window at once by Rust; each keeps the rung so
  // its own ⌘= / ⌘- steps from where the interface actually is.
  useEffect(() => {
    const p = listen<number>("parker://zoom", (e) => {
      zoomRef.current = e.payload;
      setZoom(e.payload);
    });
    return () => {
      p.then((un) => un());
    };
  }, []);

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
    if (!prefsLoaded.current) return;
    api
      .setEditorPrefs(gutterOn, wrapOn, ligaturesOn, textWidth)
      .catch(() => {});
  }, [gutterOn, wrapOn, ligaturesOn, textWidth]);
  useEffect(() => {
    if (!prefsLoaded.current) return;
    api.setPreviewSync(previewSync).catch(() => {});
  }, [previewSync]);

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

  // A note downloading from iCloud for this long is probably not coming —
  // offline, or iCloud is stuck. Say so, and offer to try again.
  const cloudKey = buffers.filter((b) => b.cloud === "downloading").map((b) => b.name).join("\n");
  useEffect(() => {
    if (!cloudKey) return;
    const names = cloudKey.split("\n");
    const id = window.setTimeout(() => {
      setBuffers((prev) =>
        prev.map((b) => (names.includes(b.name) && b.cloud === "downloading" ? { ...b, cloud: "stuck" } : b))
      );
    }, CLOUD_PATIENCE_MS);
    return () => window.clearTimeout(id);
  }, [cloudKey]);

  // Rust's fetch ended without the file.
  useEffect(() => {
    const p = listen<string>("parker://note-unavailable", (e) =>
      setBuffers((prev) => ws.setCloud(prev, e.payload, "stuck"))
    );
    return () => {
      p.then((un) => un());
    };
  }, []);

  // Try again: read once more; that restarts the fetch if it isn't running.
  const retryCloud = useCallback(async (name: string) => {
    setBuffers((prev) => ws.setCloud(prev, name, "downloading"));
    try {
      const b = await readOrCloud(name);
      if (!b.cloud) setBuffers((prev) => ws.arrived(prev, name, b.content));
    } catch (e) {
      setBuffers((prev) => ws.setCloud(prev, name, "stuck"));
      console.error("retry failed", name, e);
    }
  }, []);

  // "Save it again" on a note whose file is gone: the one way it comes back.
  const saveGone = useCallback(
    (name: string) => {
      setBuffers((prev) => ws.setGone(prev, name, false));
      stateRef.current = {
        ...stateRef.current,
        buffers: ws.setGone(stateRef.current.buffers, name, false),
      };
      void flushSave(name);
    },
    [flushSave]
  );

  const focusGroup = useCallback((id: string) => setFocusedId(id), []);

  const selectTab = useCallback(
    (groupId: string, name: string) => {
      markTabSwitch();
      apply((w) => ws.selectTab(w, groupId, name));
    },
    [apply]
  );

  // Write everything and close this note window for good. The main window
  // never comes through here: its red button hides it (see onCloseRequested).
  const closeWindow = useCallback(async () => {
    await flushAll();
    for (const b of stateRef.current.buffers) {
      if (isExternal(b.name)) await api.closeFile(b.name).catch(() => {});
    }
    await api.closeNoteWindow().catch(() => {});
  }, [flushAll]);

  // A note window shows one note at a time: the new one takes the tab, the
  // old one is written and let go of. A note another window already shows is
  // not opened twice — that window comes forward instead.
  const replaceNote = useCallback(
    async (name: string) => {
      const s = stateRef.current;
      const gid = s.focusedId;
      const g = findGroup(s.layout, gid) ?? firstGroup(s.layout);
      if (g.tabs.some((t) => noteOf(t) === name)) {
        apply((w) => ws.selectTab(w, g.id, name));
        return;
      }
      if (await api.focusNote(name).catch(() => false)) return;
      let opened: Buffer;
      try {
        opened = await readOrCloud(name);
      } catch (e) {
        console.error("open failed", name, e);
        return;
      }
      const old = g.tabs.map(noteOf).filter((n) => n !== name);
      await Promise.all(old.map((n) => flushSave(n)));
      apply((w) => {
        let next = ws.openNoteAt(w, g.id, opened);
        for (const n of old) next = ws.forgetNote(next, n);
        return next;
      });
      for (const n of old) lastWrite.current.delete(n);
      api.setNoteWindowNote(name, false).catch(() => {});
    },
    [apply, flushSave]
  );

  // `folder`: where the note is made — the picker asks for one inside the
  // folder it is showing.
  const newTab = useCallback(
    async (groupId?: string, folder?: string) => {
      const gid = groupId ?? stateRef.current.focusedId;
      try {
        const name = await api.createNote("md", folder);
        if (single) {
          await replaceNote(name);
          return;
        }
        apply((w) => ws.openNote(w, gid, { name, content: "", disk: "", dirty: false }));
      } catch (e) {
        console.error("new tab failed", e);
      }
    },
    [apply, single, replaceNote]
  );

  const closeTab = useCallback(
    async (groupId: string, id: string) => {
      if (single) {
        await closeWindow();
        return;
      }
      const name = noteOf(id);
      await flushSave(name);
      const after = apply((w) => ws.closeTab(w, groupId, id));
      // The echo record outlives the buffer otherwise, holding a copy of a note
      // nothing has open any more.
      if (!after.buffers.some((b) => b.name === name)) lastWrite.current.delete(name);
    },
    [apply, flushSave, single, closeWindow]
  );

  // Move a tab's note to a window of its own — the pane's front tab unless
  // one is named, opening on the preview if that is what the tab was. The
  // note is written first and the new window reads it back; then the tabs
  // here — editor and preview both — are let go of. The window is opened
  // before the tabs go, so a file from outside the folder is never
  // unadmitted in between. `atCursor`: the tab was dragged out and dropped;
  // the window opens where it landed.
  const popOut = useCallback(
    async (groupId?: string, tabId?: string, atCursor = false) => {
      if (single) return;
      const s = stateRef.current;
      const g = findGroup(s.layout, groupId ?? s.focusedId) ?? firstGroup(s.layout);
      const id = tabId ?? g.active;
      if (!id) return;
      const name = noteOf(id);
      await flushSave(name);
      try {
        await api.openNoteWindow(name, isPreviewTab(id), atCursor);
      } catch (e) {
        console.error("open in new window failed", name, e);
        return;
      }
      const timers = saveTimers.current;
      const pending = timers.get(name);
      if (pending) {
        clearTimeout(pending);
        timers.delete(name);
      }
      apply((w) => ws.forgetNote(w, name));
      lastWrite.current.delete(name);
    },
    [apply, flushSave, single]
  );

  // The other direction: this note window's note goes back to the main
  // window as a tab, and the window closes.
  const dockBack = useCallback(async () => {
    const s = stateRef.current;
    const active = ws.focusedGroup(s).active;
    if (!active) return;
    await flushAll();
    await api
      .dockNote(noteOf(active), isPreviewTab(active))
      .catch((e) => console.error("move back failed", e));
  }, [flushAll]);

  const toggleOnTop = useCallback(() => {
    setOnTop((v) => {
      api.setWindowOnTop(!v).catch(() => {});
      return !v;
    });
  }, []);

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

  // Toggle a pane between editor and markdown preview. A note window tells
  // Rust which way it is showing, so a relaunch brings it back the same way.
  const toggleMode = useCallback(
    (groupId: string) => {
      const after = apply((w) => ws.toggleMode(w, groupId));
      if (single) {
        const g = findGroup(after.layout, groupId);
        if (g?.active) {
          api.setNoteWindowNote(noteOf(g.active), isPreviewTab(g.active)).catch(() => {});
        }
      }
    },
    [apply, single]
  );

  // Open a live preview of the active note in a new pane to the right, leaving
  // the editor pane focused so you keep typing. (The one intentional mirror.)
  const previewToSide = useCallback(
    (groupId: string) => {
      const g = findGroup(stateRef.current.layout, groupId);
      if (!g || !g.active || !isMarkdown(noteOf(g.active))) return;
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

  // Open a note in the focused group — or a given one — loading it if not
  // already a buffer.
  // `force` skips the look around other windows — for a note handed over by
  // one of them, which may still be listed there while it closes.
  const openNote = useCallback(
    async (name: string, groupId?: string, index?: number, force = false) => {
      if (single) {
        await replaceNote(name);
        return;
      }
      const s = stateRef.current;
      const gid = groupId && findGroup(s.layout, groupId) ? groupId : s.focusedId;
      const loaded = s.buffers.find((b) => b.name === name);
      let buffer = loaded;
      if (!buffer) {
        // One note, one window: if a note window shows it, that window comes
        // forward and nothing opens here.
        if (!force && (await api.focusNote(name).catch(() => false))) return;
        try {
          buffer = await readOrCloud(name);
        } catch (e) {
          console.error("open failed", name, e);
          return;
        }
      }
      apply((w) => ws.openNoteAt(w, gid, buffer!, index));
    },
    [apply, single, replaceNote]
  );

  // A note window is parked when closed and reused for the next note — the
  // webview lives on, so what it showed must be let go of, and later taken
  // up again with whatever note comes next (windows.rs explains why).
  useEffect(() => {
    if (!single) return;
    const p1 = thisWindow.listen("parker://parked", () => {
      const timers = saveTimers.current;
      for (const id of timers.values()) clearTimeout(id);
      timers.clear();
      lastWrite.current.clear();
      apply((w) => {
        let next = w;
        for (const b of w.buffers) next = ws.forgetNote(next, b.name);
        return next;
      });
    });
    const p2 = thisWindow.listen<{ name: string; preview: boolean; onTop: boolean }>("parker://show-note",
      async (e) => {
        setOnTop(e.payload.onTop);
        await replaceNote(e.payload.name);
        const g = ws.focusedGroup(stateRef.current);
        if (g.active && isPreviewTab(g.active) !== e.payload.preview) toggleMode(g.id);
      }
    );
    return () => {
      p1.then((un) => un());
      p2.then((un) => un());
    };
  }, [single, apply, replaceNote, toggleMode]);

  // Another window handed a note over, or asks for one this window has.
  useEffect(() => {
    const p1 = thisWindow.listen<{ name: string; preview: boolean }>("parker://open-note", async (e) => {
      if (single) return;
      await openNote(e.payload.name, undefined, undefined, true);
      // It came back as it left: a preview stays a preview.
      if (e.payload.preview) {
        const s = stateRef.current;
        const g = ws.focusedGroup(s);
        if (g.active === e.payload.name) apply((w) => ws.toggleMode(w, g.id));
      }
    });
    const p2 = thisWindow.listen<string>("parker://focus-note", (e) => {
      const s = stateRef.current;
      if (s.buffers.some((b) => b.name === e.payload)) openNote(e.payload);
    });
    const p3 = thisWindow.listen("parker://pop-out", () => popOut());
    return () => {
      p1.then((un) => un());
      p2.then((un) => un());
      p3.then((un) => un());
    };
  }, [single, openNote, popOut, apply]);

  const openPicker = useCallback(() => setPickerOpen(true), []);

  // Files the OS asked Parker to open — a double-click in the Finder, File ›
  // Open…, `open -a Parker`. Rust admits and queues them and only says "come
  // and get them": the event can fire before this listener exists (a cold
  // launch by double-click), so the queue is drained once here as well, and a
  // second drain of an already-emptied queue is nothing. Opening waits for
  // the session to be restored, since the file goes into the focused pane
  // and until then there isn't one.
  useEffect(() => {
    if (!ready || single) return;
    let alive = true;
    const drain = async () => {
      if (!alive) return;
      if (!sessionRestored.current) {
        window.setTimeout(drain, 250);
        return;
      }
      // A drop lands in the pane it was dropped on, at the tab it was dropped
      // on; anything else (Finder double-click, Open…) goes to the focused
      // pane, at the end.
      const at = fileDrop.current;
      fileDrop.current = null;
      setFileDragging(false);
      let names: string[];
      try {
        names = await api.takeOpenedFiles();
      } catch {
        return;
      }
      // One after the other, so the last one asked for ends up in front.
      let index = at?.index;
      for (const name of names) {
        if (!alive) return;
        await openNote(name, at?.group, index);
        if (index !== undefined) index++;
      }
    };
    const p = listen("parker://files-opened", () => drain());
    drain();
    return () => {
      alive = false;
      p.then((un) => un());
    };
  }, [ready, single, openNote]);

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
    const id = name ?? (findGroup(s.layout, s.focusedId) ?? firstGroup(s.layout)).active;
    const n = id ? noteOf(id) : null;
    // A file from outside the folder keeps its name: Parker edits it where it
    // is and does nothing else to it.
    if (n && !isExternal(n)) setRenamingName(n);
  }, []);

  const commitRename = useCallback(
    async (oldName: string, raw: string) => {
      setRenamingName(null);
      const typed = raw.trim();
      if (!typed || isExternal(oldName)) return;
      // A bare filename stays in the note's folder; a slash moves it.
      const newName = renamedIn(oldName, typed);
      if (newName === oldName) return;
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

      // A note window has one tab and one pane: nothing to split, merge,
      // reorder or cycle through. Those keys fall through to the editor.
      const paneKeys = !single;

      if (k === ",") {
        e.preventDefault();
        api.openSettings().catch(() => {}); // the menu's ⌘, usually gets here first
      } else if (k === "n" && e.shiftKey) {
        e.preventDefault();
        popOut(fid); // ⌘⇧N — the note in front, in a window of its own
      } else if (e.code === "Slash" && e.shiftKey) {
        // ⌘? — the Mac's own key for help. ⌘K used to be this; it is the
        // editor's now, for links (lib/format.ts). The menu item carries the
        // same accelerator for the record; this handler is what answers it.
        e.preventDefault();
        api.openHelp();
      } else if (paneKeys && e.code === "Backslash" && !e.shiftKey) {
        // ⌃⌘\ split right, ⌃⌥⌘\ split down (matched by physical key so the
        // Option char doesn't matter). Ctrl isn't required — plain ⌘\ still
        // works — but it's the documented form because 1Password grabs ⌘\
        // globally for autofill, so that one never reaches us. ⌘⇧\ is left to
        // the editor — CodeMirror's "go to matching bracket".
        e.preventDefault();
        splitFocused(fid, e.altKey ? "col" : "row");
      } else if (
        paneKeys &&
        e.ctrlKey &&
        (e.code === "BracketLeft" || e.code === "BracketRight")
      ) {
        // ⌃⌘[ / ⌃⌘] move the tab; add ⌥ to move focus between panes instead.
        e.preventDefault();
        const dir = e.code === "BracketRight" ? 1 : -1;
        if (e.altKey) focusPaneByOffset(dir);
        else moveTab(dir);
      } else if (paneKeys && k === "m" && e.shiftKey) {
        e.preventDefault();
        mergeIntoParent(fid); // ⌘⇧M — merge this pane into its neighbor
      } else if (paneKeys && k === "v" && e.shiftKey) {
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
        // With the picker open, ⌘N is the picker's: a note where it is.
        if (pickerOpenRef.current) return;
        e.preventDefault();
        newTab(fid); // ⌘N — new note
      } else if (k === "w") {
        e.preventDefault();
        const g = findGroup(stateRef.current.layout, fid);
        if (g?.active) closeTab(fid, g.active);
      } else if (k === "s") {
        e.preventDefault();
        const g = findGroup(stateRef.current.layout, fid);
        if (g?.active) flushSave(noteOf(g.active));
      } else if (paneKeys && e.shiftKey && (k === "]" || k === "}")) {
        e.preventDefault();
        switchByOffset(1); // ⌘⇧] next tab (Safari/Chrome style)
      } else if (paneKeys && e.shiftKey && (k === "[" || k === "{")) {
        e.preventDefault();
        switchByOffset(-1); // ⌘⇧[ previous tab
      } else if (paneKeys && k >= "1" && k <= "9") {
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
    popOut,
    single,
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
  //
  // `drop` is listened to in the BUBBLE phase, deliberately. In capture it ran
  // before React's root listener, and the setTabDragging(false) it issued was
  // flushed in a microtask between native listeners — unmounting the
  // `dragging`-gated drop-catcher while the event was still on its way. React
  // then found no mounted fiber for the target and never dispatched the pane's
  // onDrop, so dropping a tab on a pane body silently did nothing (the tab bar
  // still worked: it isn't gated on the flag). In bubble the pane handles the
  // drop first — and dropTab clears the flag itself — so this is only the
  // safety net for drops that land on nothing.
  useEffect(() => {
    const clear = () => setTabDragging(false);
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // A file from the Finder. The DOM sees it come and go (dragenter, dragover,
  // dragleave) but never the drop: that is taken on the native side before
  // WebKit can navigate to the file, and comes back as `parker://files-opened`
  // — which is where the flag is cleared on a successful drop. Leaving the
  // window clears it too; there is no dragend for a drag the OS started.
  useEffect(() => {
    if (single) return;
    const isFile = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (isFile(e)) setFileDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (isFile(e) && e.relatedTarget === null) {
        setFileDragging(false);
        fileDrop.current = null;
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
    };
  }, [single]);

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
        // The main window hides — Parker lives on in the tray. A note window
        // closes for good: the note is on disk and a ⌘O away.
        if (single) {
          await closeWindow();
          return;
        }
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
  }, [flushAll, single, closeWindow]);

  useEffect(() => {
    const p = thisWindow.listen("parker://quit", async () => {
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
    const p = thisWindow.listen("parker://confirm-quit", () => setQuitAsk(true));
    return () => {
      p.then((un) => un());
    };
  }, []);

  // The Settings window changes the notes folder from outside this window.
  useEffect(() => {
    const p = listen<string>("parker://notes-dir", (e) => setNotesDir(e.payload));
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
      const seqAtRead = lastWrite.current.get(name)?.seq ?? 0;
      let disk: string;
      try {
        disk = await readText(name);
      } catch (e) {
        // A tool that saves by writing a temp file and renaming it into place
        // — most editors, most agents — leaves a moment with no file at the
        // path, and the watcher fires inside it. That is not a missing note;
        // it is one being replaced. Look again before saying anything.
        const msg = e instanceof Error ? e.message : String(e);
        // Evicted by iCloud again (or still): Rust is fetching it; wait.
        if (ws.readFailure(msg) === "cloud") {
          setBuffers((prev) => ws.setCloud(prev, name, "downloading"));
          return;
        }
        if (ws.readFailure(msg) === "missing") {
          await new Promise((r) => setTimeout(r, 250));
          try {
            disk = await readText(name);
          } catch (e2) {
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            // Still no file: it was deleted, trashed or moved away. Say so,
            // and stop saving it — see Buffer.gone.
            const gone = ws.readFailure(m2) === "missing";
            api.logChange(JSON.stringify({ ts: new Date().toISOString(), name, verdict: gone ? "gone" : "read-error", error: m2 })).catch(() => {});
            setBuffers((prev) =>
              gone ? ws.setGone(prev, name, true) : ws.setError(prev, name, `Could not read: ${m2}`)
            );
            return;
          }
        } else {
          api.logChange(JSON.stringify({ ts: new Date().toISOString(), name, verdict: "read-error", error: msg })).catch(() => {});
          setBuffers((prev) => ws.setError(prev, name, `Could not read: ${msg}`));
          return;
        }
      }
      const now = stateRef.current.buffers.find((b) => b.name === name);
      if (!now) return;
      // A note that was downloading has arrived: that's its text, not an edit.
      if (now.cloud) {
        setBuffers((prev) => ws.arrived(prev, name, disk));
        return;
      }
      // The file is readable: whatever a read said before is over. Only a
      // write used to clear the error, so a moment's absence stayed red. A
      // note that was gone is back — restored from the Trash, or by git.
      if (now.error?.startsWith("Could not read")) {
        setBuffers((prev) => ws.setError(prev, name, undefined));
      }
      if (now.gone) setBuffers((prev) => ws.setGone(prev, name, false));
      // Parker's own writing, which the disk baseline alone cannot always
      // recognise — see isOwnWrite.
      if (ws.isOwnWrite(lastWrite.current.get(name), disk, seqAtRead)) return;
      const verdict = ws.classifyDiskChange(now, disk);
      if (verdict === "nothing") return;
      // The diary: what was seen, for when the change is doubted afterwards.
      {
        const own = lastWrite.current.get(name);
        api
          .logChange(
            changeRecord({
              name,
              verdict,
              baseline: now.disk.length,
              disk: disk.length,
              buffer: now.content !== now.disk ? now.content.length : undefined,
              lines: changedLines(now.disk, disk),
              whitespaceOnly: whitespaceOnly(now.disk, disk),
              ownSeq: own?.seq ?? 0,
              ownMatches: own?.text === disk,
            })
          )
          .catch(() => {});
      }
      if (verdict === "conflict") {
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

  if (firstRun) {
    return (
      <FirstRun
        backend={firstRunBackend}
        onDone={async (note) => {
          firstNote.current = note;
          setNotesDir(await api.notesDirPath().catch(() => ""));
          await restoreAfterFirstRun.current?.();
          restoreAfterFirstRun.current = null;
          setFirstRun(false);
        }}
      />
    );
  }

  // Notes reloaded from disk that the user has not typed over yet. The tab
  // marks say which; this says that it happened at all, for when the tab strip
  // is scrolled or the note isn't open in this pane.
  const reloaded = ws.unseenChanges(buffers);

  const handlers: LayoutHandlers = {
    onFocus: focusGroup,
    onSelectTab: selectTab,
    onDeselectTab: (groupId) => apply((w) => ws.deselectTab(w, groupId)),
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
    onTabDragEnd: () => {
      setTabDragging(false);
      setFileDragging(false);
    },
    onFileDragOver: (group, index) => {
      fileDrop.current = { group, index };
    },
    onCloseGroup: closeGroup,
    onResolveConflict: resolveConflict,
    onSaveGone: saveGone,
    onRetryCloud: retryCloud,
    onReveal: (name) => api.revealFile(name).catch((e) => console.error("reveal failed", e)),
    onResize,
    onEqualize,
    onPopOut: popOut,
    onDragOut: async (groupId, id) => {
      if (await api.pointerOutsideWindow().catch(() => false)) popOut(groupId, id, true);
    },
  };
  const noteWindowControls = single
    ? { onTop, onToggleTop: toggleOnTop, onDockBack: dockBack }
    : undefined;

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
            <span className="search-text">
              {activeName ? displayName(activeName) : "Search notes…"}
            </span>
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
            className={"icon-btn" + (previewSync ? " on" : "")}
            onClick={() => setPreviewSync((v) => !v)}
            title="Preview follows the editor — cursor, selection, scroll"
            aria-label="Toggle preview sync"
            aria-pressed={previewSync}
          >
            <Link2 size={16} strokeWidth={1.8} aria-hidden="true" />
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
            onClick={() => api.openSettings().catch(() => {})}
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
          width={textWidth}
          previewSync={previewSync}
          images={previewImages}
          notesDir={notesDir}
          links={links}
          renamingName={renamingName}
          homeDir={homeDir}
          multiGroup={multiGroup}
          altHeld={altHeld}
          dragging={tabDragging}
          fileDragging={fileDragging}
          noteWindow={noteWindowControls}
          h={handlers}
        />
      </div>

      <div className="statusbar">
        {activeName && isExternal(activeName) ? (
          <PathLabel className="status-file" path={activeName} home={homeDir} />
        ) : (
          <span className="status-file">{activeName ?? ""}</span>
        )}
        {reloaded.length > 0 && (
          <span
            className="status-reloaded"
            title={`Reloaded from disk: ${reloaded.join(", ")}`}
          >
            <RefreshCw size={11} strokeWidth={2.5} aria-hidden />
            {reloaded.length} {reloaded.length === 1 ? "note" : "notes"} reloaded
          </span>
        )}
        {/* Git is the folder's, not a window's: one menu, one sync timer, in
            the main window. */}
        {!single && <GitMenu onBeforeCommit={flushAll} />}
        <span className="status-spacer" />
        <span className="status-count">{statusCounts}</span>
        {single ? (
          onTop && <span className="status-dir">On top</span>
        ) : (
          <span className="status-dir" title={notesDir}>
            {prettyPath(notesDir, homeDir)}
          </span>
        )}
        <button
          className="status-help"
          onClick={() => api.openHelp()}
          title="Keyboard shortcuts (Cmd+?)"
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
          onNewNote={(folder) => {
            setPickerOpen(false);
            newTab(undefined, folder);
          }}
          onDeleted={onNoteDeleted}
          onClose={() => setPickerOpen(false)}
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
