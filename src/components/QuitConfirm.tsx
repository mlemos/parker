import { useEffect, useRef } from "react";

/**
 * "Quit Parker?" — the answer to ⌘Q, the app menu and the tray.
 *
 * Parker deliberately went years without a ⌘Q accelerator, because in an app
 * you summon with a hotkey and dismiss with Escape, a stray ⌘Q is all cost and
 * no benefit. The dialog is what makes the shortcut safe to have: the keystroke
 * is now cheap to press *and* cheap to take back. Quits the user did not ask
 * for (logout, reboot) never come through here — they take the silent flush
 * path in App.tsx, since there is nobody there to answer.
 */
export function QuitConfirm({
  onQuit,
  onCancel,
}: {
  onQuit: () => void;
  onCancel: () => void;
}) {
  const quitRef = useRef<HTMLButtonElement>(null);

  // Focus the destructive button so Return confirms — the dialog exists to
  // slow a stray keystroke down by one deliberate press, not by three.
  useEffect(() => {
    quitRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onQuit();
      } else if (e.metaKey && e.key.toLowerCase() === "q") {
        // A second ⌘Q while the question is up means it: the OS sends the menu
        // item again, so without this the dialog would just re-arm itself.
        e.preventDefault();
        onQuit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onQuit, onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quit-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-title" id="quit-title">
          Quit Parker?
        </div>
        <div className="confirm-body">
          Your notes are already saved — open tabs come back exactly as you left
          them.
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="confirm-btn primary"
            ref={quitRef}
            onClick={onQuit}
          >
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
