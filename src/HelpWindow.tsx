import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { themeById, DEFAULT_THEME_ID } from "./lib/themes";
import "./App.css";

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
      ["Cycle tabs", ["⌃Tab", "⌃⇧Tab"]],
      ["Rename tab", ["⌘⇧R"]],
    ],
  },
  {
    title: "Panes (split)",
    rows: [
      ["Split right", ["⌘\\"]],
      ["Split down", ["⌘⌥\\"]],
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
      ["Insert line below", ["⌘⏎"]],
      ["Copy line up / down", ["⌘⌥↑", "⌘⌥↓"]],
      ["Move line up / down", ["⌥↑", "⌥↓"]],
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

const themeId =
  new URLSearchParams(window.location.search).get("theme") || DEFAULT_THEME_ID;
const theme = themeById(themeId);

export default function HelpWindow() {
  const [tab, setTab] = useState<"app" | "editor">("app");
  const [summon, setSummon] = useState<string>("");

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setSummon(pretty(s.shortcut)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const u = theme.ui;
    const root = document.documentElement;
    const vars: Record<string, string> = {
      "--text": u.text,
      "--secondary": u.secondary,
      "--muted": u.muted,
      "--border": u.border,
      "--accent": u.accent,
      "--danger": u.danger,
      "--editor-bg": u.editorBg,
      "--tabbar-bg": u.tabbarBg,
      "--tab-active-bg": u.tabActiveBg,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.mode = theme.mode;
    root.dataset.theme = theme.id;
    document.body.style.background = u.editorBg;
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
      <div className="helpwin-bar" data-tauri-drag-region>
        <div className="helpwin-tabs">
          <button
            className={"helpwin-tab" + (tab === "app" ? " on" : "")}
            onClick={() => setTab("app")}
          >
            App
          </button>
          <button
            className={"helpwin-tab" + (tab === "editor" ? " on" : "")}
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
