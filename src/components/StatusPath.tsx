// A path in the status bar that answers clicks (1.5.2): click copies it, ⌥-click
// copies the note's path within the notes folder, double click shows it in the
// Finder. What happened replaces the label for a moment, in green, where the
// user was looking — no toast, no sound.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { clickGate, clickWait, pathToCopy } from "../lib/status-click";

/** How long the confirmation stays. */
export const FLASH_MS = 1500;

/** The Mac's double-click time, asked once per window. */
let waitMs: number | null = null;
function loadWait() {
  if (waitMs !== null) return;
  waitMs = clickWait(null);
  api.doubleClickMs().then((ms) => (waitMs = clickWait(ms))).catch(() => {});
}

/** A word that says what just happened, for FLASH_MS, then lets go. */
export function useFlash(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | null>(null);
  useEffect(() => () => { if (t.current) window.clearTimeout(t.current); }, []);
  const show = (m: string) => {
    if (t.current) window.clearTimeout(t.current);
    setMsg(m);
    t.current = window.setTimeout(() => setMsg(null), FLASH_MS);
  };
  return [msg, show];
}

export function StatusPath({
  className,
  children,
  full,
  relative = null,
  reveal,
  unsaved,
}: {
  className: string;
  children: ReactNode;
  /** The whole path; null when there is none (a draft). */
  full: string | null;
  /** The note's path within the notes folder, for ⌥-click. */
  relative?: string | null;
  reveal: () => Promise<void>;
  /** What a click says when there is no path yet. */
  unsaved?: string;
}) {
  const [flash, show] = useFlash();
  loadWait();
  // The latest props, read when the click lands. The gate itself lives as
  // long as the label: the status bar re-renders with every caret move, and a
  // gate rebuilt then cancelled the click still waiting out the double-click
  // time (seen in Parker Dev: a click on the note's name copied nothing).
  const props = useRef({ full, relative, reveal, unsaved, show });
  props.current = { full, relative, reveal, unsaved, show };
  const gate = useMemo(
    () =>
      clickGate(
        () => waitMs ?? clickWait(null),
        (alt) => {
          const p = props.current;
          if (!p.full) {
            if (p.unsaved) p.show(p.unsaved);
            return;
          }
          const c = pathToCopy(p.full, p.relative, alt);
          api
            .copyText(c.text)
            .then(() => p.show(c.relative ? "✓ Relative path copied" : "✓ Path copied"))
            .catch(() => p.show("Couldn't copy"));
        },
        () => {
          const p = props.current;
          if (!p.full) {
            if (p.unsaved) p.show(p.unsaved);
            return;
          }
          p.reveal()
            .then(() => p.show("✓ Shown in Finder"))
            .catch(() => p.show("Couldn't show it in Finder"));
        }
      ),
    []
  );
  useEffect(() => () => gate.cancel(), [gate]);
  const hint = full
    ? relative
      ? "Click to copy the path · ⌥-click for its path in your notes · Double-click to show in Finder"
      : "Click to copy the path · Double-click to show in Finder"
    : undefined;
  return (
    <span
      className={className + " status-path" + (flash ? " flashed" : "")}
      role="button"
      title={flash ? undefined : hint}
      onClick={(e) => {
        if (e.detail > 1) return;
        gate.click(e.altKey);
      }}
      onDoubleClick={() => gate.double()}
    >
      {flash ?? children}
      <span className="sr-only" aria-live="polite">{flash ?? ""}</span>
    </span>
  );
}
