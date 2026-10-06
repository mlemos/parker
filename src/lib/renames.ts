// Drafts that became files while they were open.
//
// The name is how everything finds a note — the buffer, the tab, the editor's
// parked state, a save timer, a keystroke on its way to App. When a draft's
// first save makes its file, its id becomes the file's name everywhere at
// once, but not everything learns at once: the editor may still report an
// edit under the draft id, and a timer set a moment ago still holds it. Both
// ask here for the name the note goes by now. And the editor tells this (same
// note, keep the cursor, the scroll, the undo) from a switch to another note
// by asking here, rather than guessing from the text — two empty notes look
// alike, and guessing wrong would let ⌘Z walk one note back into the other.
//
// Drafts only: a draft id is never used twice, so what it points to is never
// wrong. A file's name can be — rename a.md to b.md, and a new a.md may come
// along — so a rename in the tab is not recorded here.

const renamed = new Map<string, string>();

export function recordRename(from: string, to: string): void {
  if (from !== to) renamed.set(from, to);
}

/** The name `name` goes by now — itself, unless it was renamed (and the
 *  rename renamed again). */
export function currentName(name: string): string {
  let n = name;
  for (let i = 0; i < 100 && renamed.has(n); i++) n = renamed.get(n)!;
  return n;
}

/** Was the note called `from` renamed to `to`? */
export function wasRenamed(from: string, to: string): boolean {
  return from !== to && currentName(from) === to;
}
