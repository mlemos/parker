// A new note is a draft until it has something in it.
//
// ⌘N used to make "Untitled-N.md" on disk at once, and every new note the
// user walked away from stayed behind as an empty file — in the folder, in
// iCloud, on the iPhone, in git. Now a new note lives only in the editor,
// under an id of its own, until its first save with content: that save
// creates the file (Rust's create_note_with) and the id becomes the file's
// name everywhere (workspace.materialize). A draft that is closed empty never
// touched the disk, so there is nothing to clean up.
//
// The id is "draft:<n>.<ext>". It keeps the extension, so everything that
// asks "is this markdown?" of a name answers right; it never starts with a
// slash (that would make it an outside file) and has no folder in it — the
// folder the note will be made in rides on the buffer (Buffer.draft).

import type { Buffer } from "./layout";

const PREFIX = "draft:";
let counter = 0;

/** Is this name a draft — a new note with no file yet? */
export function isDraft(name: string | null | undefined): boolean {
  return !!name && name.startsWith(PREFIX);
}

/** A fresh draft id. */
export function newDraftId(ext = "md"): string {
  counter += 1;
  return `${PREFIX}${counter}.${ext}`;
}

/** An empty draft, to be made in `folder` ("cos/desks/" or "") when it gets
 *  content. */
export function draftBuffer(id: string, folder = "", ext = "md"): Buffer {
  return { name: id, content: "", disk: "", dirty: false, draft: { folder, ext } };
}
