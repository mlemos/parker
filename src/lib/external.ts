// Files from outside the notes folder — opened from the Finder or File › Open…
// and edited where they are.
//
// A note is known by its path relative to the notes folder — "note.md", or
// "backlogs/note.md" in a subfolder; a file from anywhere else is known by
// its absolute path. Both are the `name` of a buffer and a tab, and since a
// note's name never starts with a slash, the leading one is the whole
// distinction. Everything in workspace.ts that moves names between panes
// works on either without knowing.

/** Is this name a path to a file outside the notes folder? */
export function isExternal(name: string | null | undefined): boolean {
  return !!name && name.startsWith("/");
}

/** What a tab shows: the filename, whatever folder it is in. */
export function displayName(name: string): string {
  const i = name.lastIndexOf("/");
  return i === -1 ? name : name.slice(i + 1);
}

/** The folder part of a note's name, with its trailing slash — "backlogs/"
 *  for "backlogs/note.md", "" for a note at the top. */
export function folderOf(name: string): string {
  const i = name.lastIndexOf("/");
  return i === -1 ? "" : name.slice(0, i + 1);
}

/** The name a rename should produce. Typing a bare filename over a note in
 *  a folder keeps it in that folder; a name with a slash is a move, taken
 *  as given. */
export function renamedIn(oldName: string, raw: string): string {
  return raw.includes("/") ? raw : folderOf(oldName) + raw;
}

/** A path in two parts for showing in one line: the tail is the last two
 *  segments — folder and file, the part that tells files apart — and the head
 *  is everything before it. A narrow label drops the *head* to an ellipsis
 *  and keeps the tail whole, so "/Volumes/work/Projects/…/repo/README.md" survives
 *  where a plain end-ellipsis left "/Volumes/work/Projects/parker/src-tauri/…". */
export function splitPath(path: string): { head: string; tail: string } {
  const segs = path.split("/");
  if (segs.length <= 3) return { head: "", tail: path };
  const tail = "/" + segs.slice(-2).join("/");
  return { head: path.slice(0, path.length - tail.length), tail };
}

/** The outside files that were loaded before and aren't any more — the ones
 *  Rust should stop serving and stop watching. Computed from the buffer lists
 *  around a workspace transition, so every way of losing a tab (close, close
 *  pane, drag away, forget) is covered without each one remembering to. */
export function droppedExternals(before: { name: string }[], after: { name: string }[]): string[] {
  const kept = new Set(after.map((b) => b.name));
  return before.filter((b) => isExternal(b.name) && !kept.has(b.name)).map((b) => b.name);
}
