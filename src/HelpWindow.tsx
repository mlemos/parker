import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./lib/api";
import { themeById, DEFAULT_THEME_ID } from "./lib/themes";
import "./App.css";

// Apply a theme's palette to this standalone window.
function applyTheme(id: string) {
  const t = themeById(id);
  const u = t.ui;
  const root = document.documentElement;
  const vars: Record<string, string> = {
    "--text": u.text,
    "--secondary": u.secondary,
    "--muted": u.muted,
    "--border": u.border,
    "--accent": u.accent,
    "--danger": u.danger,
    "--editor-bg": u.editorBg,
    "--header-bg": u.headerBg,
    "--tabbar-bg": u.tabbarBg,
    "--tab-active-bg": u.tabActiveBg,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = t.mode;
  root.dataset.theme = t.id;
  document.body.style.background = u.editorBg;
}

function pretty(accel: string): string {
  return accel
    .replace(/CmdOrCtrl|Cmd|Super|Meta/gi, "⌘")
    .replace(/Alt|Option/gi, "⌥")
    .replace(/Shift/gi, "⇧")
    .replace(/Ctrl|Control/gi, "⌃")
    .replace(/\+/g, "");
}

type Row = [label: string, keys: string[]];
type Section = { title: string; rows: Row[] };

const APP: Section[] = [
  {
    title: "Notes & tabs",
    rows: [
      ["New note", ["⌘N"]],
      ["Open / search notes", ["⌘O"]],
      ["Save now", ["⌘S"]],
      ["Close tab", ["⌘W"]],
      ["Go to tab 1–9", ["⌘1–9"]],
      ["Previous / next tab", ["⌘⇧[", "⌘⇧]"]],
      ["Move tab left / right", ["⌃⌘[", "⌃⌘]"]],
      ["Rename tab", ["⌘⇧R"]],
    ],
  },
  {
    title: "Panes (split)",
    rows: [
      ["Split right", ["⌃⌘\\"]],
      ["Split down", ["⌃⌥⌘\\"]],
      ["Focus previous / next pane", ["⌃⌥⌘[", "⌃⌥⌘]"]],
      ["Merge pane into neighbor", ["⌘⇧M"]],
      ["Markdown preview to the side", ["⌘⇧V"]],
    ],
  },
  {
    title: "View & app",
    rows: [
      ["Font size up / down", ["⌘=", "⌘-"]],
      ["Reset font size", ["⌘0"]],
      ["Commit & push (quick)", ["⌘⇧S"]],
      ["Settings", ["⌘,"]],
      ["This help", ["⌘K"]],
    ],
  },
];

const EDITOR: Section[] = [
  {
    title: "Editing",
    rows: [
      ["Toggle comment", ["⌘/"]],
      ["Outdent / Indent", ["⌘[", "⌘]"]],
      ["Indent / outdent selection", ["Tab", "⇧Tab"]],
      ["Delete line", ["⌘⇧K"]],
      ["Copy line up / down", ["⌘⌥↑", "⌘⌥↓"]],
      ["Move line up / down", ["⌥↑", "⌥↓"]],
    ],
  },
  {
    title: "To-dos — /TODO /DOING /PAUSE /WAIT /ATTN /DONE /FAIL /CANCEL",
    rows: [
      ["Rotate: todo → doing → paused → waiting → attention → done → fail → cancel", ["⌘⏎"]],
      ["Complete / reopen (on the checkbox)", ["Click"]],
      ["Cycle paused / waiting / attention / fail / cancel", ["⌥Click"]],
    ],
  },
  {
    title: "Selection & search",
    rows: [
      ["Select all", ["⌘A"]],
      ["Select next occurrence", ["⌘D"]],
      ["Select all occurrences", ["⌘⇧L"]],
      ["Find", ["⌘F"]],
      ["Find next / previous", ["⌘G", "⌘⇧G"]],
    ],
  },
  {
    title: "Navigation",
    rows: [
      ["Line start / end", ["⌘←", "⌘→"]],
      ["Document start / end", ["⌘↑", "⌘↓"]],
      ["Go to matching bracket", ["⌘⇧\\"]],
    ],
  },
  {
    title: "History & clipboard",
    rows: [
      ["Undo / redo", ["⌘Z", "⌘⇧Z"]],
      ["Cut / copy / paste", ["⌘X", "⌘C", "⌘V"]],
    ],
  },
];

const GESTURES: string[] = [
  "Double-click a tab to rename it.",
  "Drag a tab to reorder — or drop it onto another pane to move it there.",
  "Hold ⌥ over a pane's buttons: split becomes merge, preview becomes side-by-side.",
  "Double-click a split divider to re-center the two panes.",
  "Double-click the palette icon to reset the theme to Vercel Dark.",
];

const initialTheme =
  new URLSearchParams(window.location.search).get("theme") || DEFAULT_THEME_ID;

// Paint the theme onto the document before React's first render so the very
// first frame is already styled (the window itself is created hidden in Rust).
applyTheme(initialTheme);

export default function HelpWindow() {
  const [tab, setTab] = useState<"app" | "editor">("app");
  const [summon, setSummon] = useState<string>("");

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setSummon(pretty(s.shortcut)))
      .catch(() => {});
  }, []);

  // The theme is already applied at module load; here we just reveal the
  // window once the themed content has painted, then follow live theme changes.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      getCurrentWindow().show().catch(() => {});
      getCurrentWindow().setFocus().catch(() => {});
    });
    const p = listen<string>("parker://theme", (e) => applyTheme(e.payload));
    return () => {
      cancelAnimationFrame(raf);
      p.then((un) => un());
    };
  }, []);

  const appSections: Section[] = APP.map((s) =>
    s.title === "View & app" && summon
      ? {
          ...s,
          rows: [...s.rows, ["Summon / hide Parker (global)", [summon]]],
        }
      : s
  );
  const sections = tab === "app" ? appSections : EDITOR;

  return (
    <div className="helpwin">
      <div className="titlebar" data-tauri-drag-region>
        <div className="tb-left" data-tauri-drag-region />
        <div className="tb-center" data-tauri-drag-region>
          <span className="helpwin-title">Keyboard Shortcuts</span>
        </div>
        <div className="tb-right" data-tauri-drag-region />
      </div>

      <div className="tabstrip">
        <div className="tabs">
          <button
            className={"tab" + (tab === "app" ? " active" : "")}
            onClick={() => setTab("app")}
          >
            App
          </button>
          <button
            className={"tab" + (tab === "editor" ? " active" : "")}
            onClick={() => setTab("editor")}
          >
            Editor
          </button>
        </div>
      </div>

      <div className="helpwin-body">
        <div className="sc-grid">
          {sections.map((sec) => (
            <div className="sc-section" key={sec.title}>
              <div className="sc-title">{sec.title}</div>
              {sec.rows.map(([label, keys]) => (
                <div className="sc-row" key={label}>
                  <span className="sc-label">{label}</span>
                  <span className="sc-keys">
                    {keys.map((k) => (
                      <kbd className="sc-key" key={k}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {tab === "app" && (
          <div className="sc-gestures">
            <div className="sc-title">Mouse</div>
            <ul>
              {GESTURES.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
