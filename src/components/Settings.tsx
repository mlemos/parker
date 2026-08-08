import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { SettingsInfo } from "../lib/api";
import { prettyPath } from "../lib/path";

// Render "Alt+Space" as "⌥Space", "CmdOrCtrl+," as "⌘,", etc.
function prettyShortcut(s: string): string {
  return s
    .replace(/CmdOrCtrl|Cmd|Super|Meta/gi, "⌘")
    .replace(/Alt|Option/gi, "⌥")
    .replace(/Shift/gi, "⇧")
    .replace(/Ctrl|Control/gi, "⌃")
    .replace(/\+/g, "");
}

// Build a Tauri accelerator string (e.g. "CmdOrCtrl+Shift+P") from a keydown.
// Returns null for modifier-only presses or combos without a modifier.
const CODE_MAP: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
};

function accelFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push("CmdOrCtrl");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");

  const code = e.code;
  let key: string | null = null;
  if (code.startsWith("Key")) key = code.slice(3);
  else if (code.startsWith("Digit")) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else key = CODE_MAP[code] ?? null;

  // Need a real (non-modifier) key AND at least one modifier.
  if (!key || mods.length === 0) return null;
  return [...mods, key].join("+");
}

export function Settings({
  homeDir,
  onClose,
  onNotesDirChange,
}: {
  homeDir: string;
  onClose: () => void;
  onNotesDirChange: (dir: string) => void;
}) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setInfo).catch((e) => setError(String(e)));
  }, []);

  // One keyboard handler: while recording a shortcut it captures the combo;
  // otherwise Esc closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recording) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setRecording(false);
          return;
        }
        const accel = accelFromEvent(e);
        if (!accel) return; // wait for a full modifier+key combo
        setRecording(false);
        api
          .setShortcut(accel)
          .then(() => {
            setInfo((cur) => (cur ? { ...cur, shortcut: accel } : cur));
            setError(null);
          })
          .catch((err) => setError(String(err)));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onClose]);

  const toggleAutostart = async () => {
    if (!info || busy) return;
    setBusy(true);
    setError(null);
    const next = !info.autostart;
    try {
      await api.setAutostart(next);
      setInfo({ ...info, autostart: next });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    if (busy) return;
    setError(null);
    try {
      const picked = await api.pickNotesDir();
      if (!picked || !info) return;
      if (picked === info.notes_dir) return;
      setPendingDir(picked); // ask about moving existing notes first
    } catch (e) {
      setError(String(e));
    }
  };

  const applyFolder = async (move: boolean) => {
    if (!pendingDir || !info) return;
    setBusy(true);
    setError(null);
    try {
      const resolved = await api.setNotesDir(pendingDir, move);
      setInfo({ ...info, notes_dir: resolved });
      onNotesDirChange(resolved);
      setPendingDir(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span>Settings</span>
          <button className="settings-x" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        {!info && !error && <div className="settings-loading">Loading…</div>}

        {info && (
          <div className="settings-body">
            {/* Launch at login */}
            <div className="settings-row">
              <div className="settings-label">
                <div className="settings-title">Launch at login</div>
                <div className="settings-sub">
                  Start Parker automatically when you log in to your Mac.
                </div>
              </div>
              <button
                className={"switch" + (info.autostart ? " on" : "")}
                onClick={toggleAutostart}
                disabled={busy}
                role="switch"
                aria-checked={info.autostart}
                title="Toggle launch at login"
              >
                <span className="switch-knob" />
              </button>
            </div>

            {/* Data folder */}
            <div className="settings-row">
              <div className="settings-label">
                <div className="settings-title">Notes folder</div>
                <div className="settings-sub settings-path" title={info.notes_dir}>
                  {prettyPath(info.notes_dir, homeDir)}
                </div>
              </div>
              <button
                className="settings-btn"
                onClick={chooseFolder}
                disabled={busy || pendingDir !== null}
              >
                Change…
              </button>
            </div>

            {pendingDir && (
              <div className="settings-confirm">
                <div className="settings-sub">
                  Move your existing notes into
                  <br />
                  <span className="settings-path">
                    {prettyPath(pendingDir, homeDir)}
                  </span>
                  ?
                </div>
                <div className="settings-confirm-actions">
                  <button
                    className="settings-btn"
                    onClick={() => applyFolder(false)}
                    disabled={busy}
                  >
                    Just switch
                  </button>
                  <button
                    className="settings-btn primary"
                    onClick={() => applyFolder(true)}
                    disabled={busy}
                  >
                    Move my notes
                  </button>
                </div>
              </div>
            )}

            {/* Global shortcut — click to record a new combo */}
            <div className="settings-row">
              <div className="settings-label">
                <div className="settings-title">Global shortcut</div>
                <div className="settings-sub">
                  {recording
                    ? "Press the new shortcut… (Esc to cancel)"
                    : "Summon or dismiss Parker from any app."}
                </div>
              </div>
              <button
                className={"kbd kbd-btn" + (recording ? " recording" : "")}
                onClick={() => setRecording((r) => !r)}
                disabled={busy}
                title="Click, then press a new shortcut"
              >
                {recording ? "Recording…" : prettyShortcut(info.shortcut)}
              </button>
            </div>
          </div>
        )}

        {error && <div className="settings-error">{error}</div>}
      </div>
    </div>
  );
}
