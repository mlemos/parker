// Files from outside the notes folder — opened from the Finder or File › Open…
// and edited where they are.
//
// A note is known by its bare filename; a file from anywhere else is known by
// its absolute path. Both are the `name` of a buffer and a tab, and since a
// note's name can never contain a slash, the leading one is the whole
// distinction. Everything in workspace.ts that moves names between panes
// works on either without knowing.

/** Is this name a path to a file outside the notes folder? */
export function isExternal(name: string | null | undefined): boolean {
  return !!name && name.startsWith("/");
}

/** What a tab shows: the filename, for a path; the name itself, for a note. */
export function displayName(name: string): string {
  if (!isExternal(name)) return name;
  const i = name.lastIndexOf("/");
  return i === -1 ? name : name.slice(i + 1);
}
