// How the editor tells the side-by-side preview where it is.
//
// Not React state: the cursor moves on every keystroke, and a preview that
// re-rendered for each would run markdown-it in the typing path. The editor
// posts where it is on the window, the preview listens and moves its own DOM.
// The last position per note is kept, so a preview opened after the cursor
// settled starts in the right place.

/** Where the cursor is in a note, in 1-based lines. `from`/`to` are the
 *  selection's ends (equal when nothing is selected). */
export interface CursorPos {
  name: string;
  line: number;
  from: number;
  to: number;
}

/** What the editor shows: its first visible line. */
export interface Viewport {
  name: string;
  top: number;
}

const CURSOR = "parker:cursor";
const VIEWPORT = "parker:viewport";

const lastCursor = new Map<string, CursorPos>();
const lastViewport = new Map<string, Viewport>();

export function postCursor(pos: CursorPos): void {
  lastCursor.set(pos.name, pos);
  window.dispatchEvent(new CustomEvent<CursorPos>(CURSOR, { detail: pos }));
}

export function postViewport(vp: Viewport): void {
  lastViewport.set(vp.name, vp);
  window.dispatchEvent(new CustomEvent<Viewport>(VIEWPORT, { detail: vp }));
}

export function cursorOf(name: string): CursorPos | undefined {
  return lastCursor.get(name);
}

export function viewportOf(name: string): Viewport | undefined {
  return lastViewport.get(name);
}

/** Listen for one note's cursor. Returns the unsubscribe. */
export function onCursor(name: string, cb: (pos: CursorPos) => void): () => void {
  const h = (e: Event) => {
    const pos = (e as CustomEvent<CursorPos>).detail;
    if (pos.name === name) cb(pos);
  };
  window.addEventListener(CURSOR, h);
  return () => window.removeEventListener(CURSOR, h);
}

export function onViewport(name: string, cb: (vp: Viewport) => void): () => void {
  const h = (e: Event) => {
    const vp = (e as CustomEvent<Viewport>).detail;
    if (vp.name === name) cb(vp);
  };
  window.addEventListener(VIEWPORT, h);
  return () => window.removeEventListener(VIEWPORT, h);
}

/** Forget a note's last position — it was closed, or renamed away. */
export function forgetPosition(name: string): void {
  lastCursor.delete(name);
  lastViewport.delete(name);
}
