// One save of one note, with nothing written over an edit Parker didn't hear.
//
// The watcher is how outside changes reach an open note promptly, but it is
// not trusted to be how they arrive at all: FSEvents drops events, a sync
// lands while the Mac sleeps, a read races a write. So every save is guarded
// (Rust's guarded_write): the file is written only if it still holds a text
// Parker knows it by. If it doesn't, nothing is written and the save itself
// opens the conflict — the case the watcher would have caught, caught here.
//
// The steps and their order matter, so they live here, apart from App, where
// they can be driven and checked one outcome at a time.

import type { WriteOutcome } from "./api";
import type { Buffer } from "./layout";
import type { OwnWrite } from "./workspace";
import { readFailure } from "./workspace";

export type SaveResult =
  /** On disk: `written` is the file's text now. */
  | { kind: "saved"; written: string }
  /** The file moved underneath, unheard: `disk` is what it holds. Nothing
   *  was written. */
  | { kind: "conflict"; disk: string }
  /** The file is not there. Nothing was written. */
  | { kind: "gone" }
  /** The file was missing a moment and is back (a tool replacing it): save
   *  again, once. */
  | { kind: "retry" }
  | { kind: "error"; message: string };

export interface SaveDeps {
  /** The guarded write: `expected` are the texts the file may hold. */
  write(content: string, expected: string[]): Promise<WriteOutcome>;
  read(): Promise<string>;
  /** Record (or forget, with undefined) Parker's own last write. */
  record(own: OwnWrite | undefined): void;
  wait(ms: number): Promise<void>;
}

export async function guardedSave(buf: Buffer, before: OwnWrite | undefined, d: SaveDeps): Promise<SaveResult> {
  const written = buf.content;
  // What the file may hold and still be Parker's to replace: what it last
  // read or reloaded, and what it last wrote — the baseline can lag that
  // write by a render.
  const expected = before ? [buf.disk, before.text] : [buf.disk];
  // Recorded before the write goes out, not when it returns: the watcher can
  // hear of the new file first, and an unrecorded change of Parker's own read
  // as somebody else's edit (05/10, the backlog).
  const seq = (before?.seq ?? 0) + 1;
  d.record({ text: written, seq });
  let outcome: WriteOutcome;
  try {
    outcome = await d.write(written, expected);
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
  if (outcome.kind === "written") return { kind: "saved", written };
  // Nothing was written: the record goes back to what is true. The count
  // stays moved on, so a read that straddled this attempt is not taken for
  // news — the outcome is the news.
  d.record(before ? { text: before.text, seq } : undefined);
  if (outcome.kind === "changed") return { kind: "conflict", disk: outcome.disk };
  // Missing. A tool that saves by replacing the file leaves a moment with no
  // file at the path; look again. Only a file truly not there is gone — one
  // iCloud holds and this Mac doesn't is still there.
  await d.wait(250);
  const gone = await d.read().then(
    () => false,
    (e) => readFailure(e instanceof Error ? e.message : String(e)) === "missing"
  );
  return gone ? { kind: "gone" } : { kind: "retry" };
}
