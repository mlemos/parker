import { useEffect, useState } from "react";
import { X } from "lucide-react";
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

// [label, keys] — each key string renders as its own <kbd> chip.
type Row = [label: string, keys: string[]];

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "Notes & tabs",
    rows: [
      ["New note", ["⌘T"]],
      ["Open / search notes", ["⌘O"]],
      ["Save now", ["⌘S"]],
      ["Close tab", ["⌘W"]],
      ["Go to tab 1–9", ["⌘1–9"]],
      ["Previous / next tab", ["⌘[", "⌘]"]],
      ["Move tab left / right", ["⌘⇧[", "⌘⇧]"]],
      ["Rename tab", ["F2", "⌘⇧R"]],
    ],
  },
  {
    title: "Panes (split)",
    rows: [
      ["Split right", ["⌘\\"]],
      ["Split down", ["⌘⇧\\"]],
      ["Markdown preview to the side", ["⌘⇧V"]],
    ],
  },
  {
    title: "View",
    rows: [
      ["Font size up / down", ["⌘=", "⌘-"]],
      ["Reset font size", ["⌘0"]],
      ["Toggle line numbers", ["⌘⇧L"]],
      ["Cycle theme", ["⌘⇧T"]],
    ],
  },
  {
    title: "Git & app",
    rows: [
      ["Commit & push (quick)", ["⌘⇧S"]],
      ["Settings", ["⌘,"]],
      ["This help", ["⌘K"]],
      ["Quit", ["⌘Q"]],
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

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sc-head">
          <span>Keyboard shortcuts</span>
          <button className="sc-x" onClick={onClose} title="Close (Esc)">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="sc-grid">
          {SECTIONS.map((sec) => {
            const rows: Row[] =
              sec.title === "Git & app" && summon
                ? [...sec.rows, ["Summon / hide Parker (global)", [summon]]]
                : sec.rows;
            return (
              <div className="sc-section" key={sec.title}>
                <div className="sc-title">{sec.title}</div>
                {rows.map(([label, keys]) => (
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
            );
          })}
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
