// The status bar's paths answer clicks (1.5.2): a click copies the path,
// ⌥-click the note's path within the notes folder, a double click shows it in
// the Finder. And whatever happened is said, briefly, where it happened.
//
// A double click arrives as two clicks. The first can't know a second is
// coming, so a single click waits for the Mac's double-click time before it
// acts — capped, so a click still feels immediate — and a second click within
// that time cancels it and becomes the double click. Nothing happens that the
// user didn't ask for: a double click shows the Finder and copies nothing.

/** How long a single click waits to be sure it isn't half a double click:
 *  the Mac's own double-click time, never more than `cap`. */
export function clickWait(macMs: number | null | undefined, cap = 300): number {
  if (!macMs || !Number.isFinite(macMs) || macMs <= 0) return cap;
  return Math.min(macMs, cap);
}

export interface ClickGate {
  /** A click: `alt` is whether ⌥ was held. */
  click(alt: boolean): void;
  /** The second click of a double click. */
  double(): void;
  /** Forget a pending click (unmount). */
  cancel(): void;
}

/** Turns clicks into one single or one double, never both. */
export function clickGate(
  wait: () => number,
  onSingle: (alt: boolean) => void,
  onDouble: () => void,
  timers: { set: (f: () => void, ms: number) => number; clear: (id: number) => void } = {
    set: (f, ms) => window.setTimeout(f, ms),
    clear: (id) => window.clearTimeout(id),
  }
): ClickGate {
  let pending: number | null = null;
  const cancel = () => {
    if (pending !== null) timers.clear(pending);
    pending = null;
  };
  return {
    click(alt) {
      cancel();
      pending = timers.set(() => {
        pending = null;
        onSingle(alt);
      }, wait());
    },
    double() {
      cancel();
      onDouble();
    },
    cancel,
  };
}

/** The path a click copies: the whole path, or with ⌥ the note's path within
 *  the notes folder (when it has one — a file from outside the folder, or the
 *  folder itself, only has the whole path). */
export function pathToCopy(full: string, relative: string | null, alt: boolean): { text: string; relative: boolean } {
  return alt && relative ? { text: relative, relative: true } : { text: full, relative: false };
}

/** A note's whole path from its name: the notes folder joined to it, or the
 *  name itself for a file from outside the folder (already absolute). */
export function fullPath(notesDir: string, name: string): string {
  if (name.startsWith("/")) return name;
  return notesDir.replace(/\/+$/, "") + "/" + name;
}
