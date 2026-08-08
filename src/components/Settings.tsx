import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { SettingsInfo } from "../lib/api";

// Render "Alt+Space" as "⌥Space", "CmdOrCtrl+," as "⌘,", etc.
function prettyShortcut(s: string): string {
  return s
    .replace(/CmdOrCtrl|Cmd|Super|Meta/gi, "⌘")
    .replace(/Alt|Option/gi, "⌥")
    .replace(/Shift/gi, "⇧")
    .replace(/Ctrl|Control/gi, "⌃")
    .replace(/\+/g, "");
}

export function Settings({
  onClose,
  onNotesDirChange,
}: {
  onClose: () => void;
  onNotesDirChange: (dir: string) => void;
}) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setInfo).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

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
                  {info.notes_dir}
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
                  <span className="settings-path">{pendingDir}</span>?
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

            {/* Global shortcut (read-only for now) */}
            <div className="settings-row">
              <div className="settings-label">
                <div className="settings-title">Global shortcut</div>
                <div className="settings-sub">
                  Summon or dismiss Parker from any app.
                </div>
              </div>
              <kbd className="kbd">{prettyShortcut(info.shortcut)}</kbd>
            </div>
          </div>
        )}

        {error && <div className="settings-error">{error}</div>}
      </div>
    </div>
  );
}
