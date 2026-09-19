// Rules about the saved session, kept out of App so they can be asserted on.

import type { Session } from "./api";

/** Is this the first time Parker runs — no session ever written? A first
 *  launch gets a note to type into. A session that merely has nothing open
 *  (the last tab was closed, or every note it listed is gone) is not a first
 *  launch: it comes back as the empty pane it was. Making a note in that
 *  case is how Untitled files used to pile up, one per launch. */
export function isFirstLaunch(session: Session): boolean {
  return !session.layout && (session.open ?? []).length === 0;
}
