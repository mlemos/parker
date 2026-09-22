// The folder side of the ⌘O picker, as pure functions over names: which
// folders sit under a scope, what a search finds among them, where a typed
// "desks/" leads. A scope is "" for the root or a folder path with its
// trailing slash ("cos/desks/"); a folder from the Rust walk has none
// ("cos/desks"). Notes are relative names ("cos/desks/a.md").

export interface FolderRow {
  /** With the trailing slash: "cos/desks/". */
  path: string;
  /** Notes inside, at any depth. */
  count: number;
  /** The newest note inside, seconds since the epoch; 0 when empty. */
  modified: number;
}

interface Dated {
  name: string;
  modified: number;
}

/** "cos/desks/" → "desks". */
export function folderName(scope: string): string {
  const bare = scope.replace(/\/$/, "");
  const i = bare.lastIndexOf("/");
  return i === -1 ? bare : bare.slice(i + 1);
}

/** The scope one level up: "cos/desks/" → "cos/", "cos/" → "". */
export function parentScope(scope: string): string {
  const bare = scope.replace(/\/$/, "");
  const i = bare.lastIndexOf("/");
  return i === -1 ? "" : bare.slice(0, i + 1);
}

/** Every folder — the walked ones, plus any a note's name implies (a note
 *  can arrive before the walk has), as paths with the trailing slash. */
function allFolders(folders: string[], notes: Dated[]): Set<string> {
  const out = new Set<string>();
  for (const f of folders) if (f) out.add(f.replace(/\/$/, "") + "/");
  for (const n of notes) {
    const parts = n.name.split("/");
    for (let d = 1; d < parts.length; d++) out.add(parts.slice(0, d).join("/") + "/");
  }
  return out;
}

function row(path: string, notes: Dated[]): FolderRow {
  let count = 0;
  let modified = 0;
  for (const n of notes) {
    if (n.name.startsWith(path)) {
      count++;
      if (n.modified > modified) modified = n.modified;
    }
  }
  return { path, count, modified };
}

/** The folders directly under `scope`, alphabetically — an underscore or a
 *  capital sorts where the names put it; whoever named them meant that. */
export function childFolders(folders: string[], notes: Dated[], scope: string): FolderRow[] {
  return [...allFolders(folders, notes)]
    .filter((p) => p.startsWith(scope) && p !== scope && !p.slice(scope.length, -1).includes("/"))
    .sort()
    .map((p) => row(p, notes));
}

/** The folders below `scope`, at any depth, whose own name contains the
 *  query — "des" finds desks/ and cos/desks/ alike. */
export function matchingFolders(
  folders: string[],
  notes: Dated[],
  scope: string,
  query: string
): FolderRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [...allFolders(folders, notes)]
    .filter((p) => p.startsWith(scope) && p !== scope && folderName(p).toLowerCase().includes(q))
    .sort()
    .map((p) => row(p, notes));
}

/** Typing a folder's name and a slash walks into it: the scope the query
 *  leads to, or null when it is not that gesture. Case-insensitive, and the
 *  name is the whole of it — "des/" is not "desks/". */
export function scopeTyped(
  query: string,
  scope: string,
  folders: string[],
  notes: Dated[]
): string | null {
  if (!query.endsWith("/") || query.length < 2) return null;
  const typed = query.slice(0, -1).toLowerCase();
  const hit = childFolders(folders, notes, scope).find(
    (f) => folderName(f.path).toLowerCase() === typed
  );
  return hit ? hit.path : null;
}
