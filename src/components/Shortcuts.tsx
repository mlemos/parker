import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Tauri accelerator → mac symbols (e.g. "Ctrl+Alt+P" → "⌃⌥P").
function pretty(accel: string): string {
  return accel
    .replace(/CmdOrCtrl|Cmd|Super|Meta/gi, "⌘")
    .replace(/Alt|Option/gi, "⌥")
    .replace(/Shift/gi, "⇧")
    .replace(/Ctrl|Control/gi, "⌃")
    .replace(/\+/g, "");
}

type Row = [keys: string, label: string];

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "Notes & tabs",
    rows: [
      ["⌘T", "New note"],
      ["⌘O", "Open / search notes"],
      ["⌘S", "Save now"],
      ["⌘W", "Close tab"],
      ["⌘1 – ⌘9", "Go to tab 1–9"],
      ["⌘[  ⌘]", "Previous / next tab"],
      ["⌘⇧[  ⌘⇧]", "Move tab left / right"],
      ["F2  ⌘⇧R", "Rename tab"],
    ],
  },
  {
    title: "Panes (split)",
    rows: [
      ["⌘\\", "Split right"],
      ["⌘⇧\\", "Split down"],
      ["⌘⇧V", "Markdown preview to the side"],
    ],
  },
  {
    title: "View",
    rows: [
      ["⌘=  ⌘-", "Font size up / down"],
      ["⌘0", "Reset font size"],
      ["⌘⇧L", "Toggle line numbers"],
      ["⌘⇧T", "Cycle theme"],
    ],
  },
  {
    title: "Git & app",
    rows: [
      ["⌘⇧S", "Commit & push (quick)"],
      ["⌘,", "Settings"],
      ["⌘/", "This help"],
      ["⌘Q", "Quit"],
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

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const [summon, setSummon] = useState<string>("");

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setSummon(pretty(s.shortcut)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const appRows: Row[] = summon
    ? [[summon, "Summon / hide Parker (global — change in Settings)"]]
    : [];

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sc-head">
          <span>Keyboard shortcuts</span>
          <button className="sc-x" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="sc-grid">
          {SECTIONS.map((sec) => (
            <div className="sc-section" key={sec.title}>
              <div className="sc-title">{sec.title}</div>
              {sec.rows
                .concat(sec.title === "Git & app" ? appRows : [])
                .map(([keys, label]) => (
                  <div className="sc-row" key={label}>
                    <span className="sc-label">{label}</span>
                    <kbd className="sc-keys">{keys}</kbd>
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="sc-gestures">
          <div className="sc-title">Mouse</div>
          <ul>
            {GESTURES.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>

        <div className="sc-foot">Press Esc to close</div>
      </div>
    </div>
  );
}
