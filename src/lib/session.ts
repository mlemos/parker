// Rules about the saved session, kept out of App so they can be asserted on.

import type { Session } from "./api";
import { isDraft } from "./draft";
import { noteOf, pruneLayout } from "./layout";
import type { Buffer, LayoutNode } from "./layout";

/** Is this the first time Parker runs — no session ever written? A first
 *  launch gets a note to type into. A session that merely has nothing open
 *  (the last tab was closed, or every note it listed is gone) is not a first
 *  launch: it comes back as the empty pane it was. Making a note in that
 *  case is how Untitled files used to pile up, one per launch. */
export function isFirstLaunch(session: Session): boolean {
  return !session.layout && (session.open ?? []).length === 0;
}

/** What is written to the session: every open note, the layout, what has
 *  focus — less the drafts. A draft has no file to come back to; a pane that
 *  held only drafts comes back empty, and an active draft hands its place to
 *  the pane's first note. */
export function sessionOf(
  s: { buffers: Buffer[]; layout: LayoutNode; focusedId: string; themeId: string },
  active: string | null
): Omit<Session, "theme_bg"> {
  const real = s.buffers.map((b) => b.name).filter((n) => !isDraft(n));
  return {
    open: real,
    active: active && !isDraft(noteOf(active)) ? active : null,
    theme: s.themeId,
    layout: pruneLayout(s.layout, new Set(real)),
    focused: s.focusedId,
  };
}
