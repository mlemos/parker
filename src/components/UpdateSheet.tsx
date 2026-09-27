// The update, when Parker has found one (Onda 6): the version, its notes, and
// three ways out — Update & Restart, Later (the badge stays), Skip This
// Version (it goes until a newer one). Nothing is downloaded until the first
// is pressed; then the button counts the download, and Parker restarts
// through the quit path. The same sheet answers Check for Updates… when there
// is nothing to show ("You're up to date") or the check failed.
import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "../lib/markdown";
import { checkResult, progressLabel } from "../lib/updates";
import type { UpdateInfo } from "../lib/updates";

export function UpdateSheet({
  update,
  current,
  blocked,
  progress,
  error,
  result,
  onInstall,
  onLater,
  onSkip,
}: {
  /** The update to offer; null to show `result` instead. */
  update: UpdateInfo | null;
  current: string;
  /** Why this copy can't update itself, if it can't. */
  blocked: string | null;
  /** Bytes downloaded and the total, once Update & Restart was pressed. */
  progress: { got: number; total: number | null } | null;
  error: string | null;
  /** A Check for Updates… that found nothing, or failed. */
  result?: { status: "none" | "error"; message?: string };
  onInstall: () => void;
  onLater: () => void;
  onSkip: () => void;
}) {
  const mainRef = useRef<HTMLButtonElement>(null);
  const notes = useMemo(() => renderMarkdown(update?.notes || "", { images: "none" }), [update?.notes]);
  const working = progress !== null && !error;

  useEffect(() => {
    mainRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !working) {
        e.preventDefault();
        onLater();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onLater, working]);

  if (!update) {
    return (
      <div className="modal-overlay" onMouseDown={onLater}>
        <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="upd-title" onMouseDown={(e) => e.stopPropagation()}>
          <div className="confirm-title" id="upd-title">
            {result?.status === "error" ? "Couldn't check for updates" : "You're up to date"}
          </div>
          <div className="confirm-body">
            {result?.status === "error" ? result.message : checkResult(current, null)}
          </div>
          <div className="confirm-actions">
            <button className="confirm-btn primary" ref={mainRef} onClick={onLater}>
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onMouseDown={working ? undefined : onLater}>
      <div
        className="confirm update-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upd-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-title" id="upd-title">
          Parker {update.version} is available
        </div>
        <div className="confirm-body">You have {update.current}. Your notes are saved first, and your tabs and windows come back after the restart.</div>
        {update.notes && (
          // Rendered with images off: release notes fetch nothing.
          <div className="md-body update-notes" dangerouslySetInnerHTML={{ __html: notes }} />
        )}
        {blocked && (
          <div className="update-blocked" role="note">
            {blocked}
          </div>
        )}
        {error && (
          <div className="update-error" role="alert">
            {error}
          </div>
        )}
        <div className="confirm-actions">
          <button className="confirm-btn update-skip" disabled={working} onClick={onSkip}>
            Skip This Version
          </button>
          <span className="update-grow" />
          <button className="confirm-btn" disabled={working} onClick={onLater}>
            Later
          </button>
          <button className="confirm-btn primary" ref={mainRef} disabled={working || !!blocked} onClick={onInstall}>
            {working ? progressLabel(progress!.got, progress!.total) : "Update & Restart"}
          </button>
        </div>
      </div>
    </div>
  );
}
