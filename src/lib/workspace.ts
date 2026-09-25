// The editor workspace: which notes are loaded, how the panes are arranged,
// and which pane holds the keyboard. Everything here is a pure function of
// that state — no React, no disk.
//
// The I/O lives in App: it reads and writes notes, then hands the results in
// and applies whatever comes back. That split is what makes the rules below
// something you can assert on. An operation that needs a file to exist first
// says so in its return value rather than reaching for the filesystem.

import {
  allGroups,
  findGroup,
  firstGroup,
  groupWithTab,
  isPreviewTab,
  makeGroup,
  noteOf,
  previewTab,
  removeGroup,
  siblingGroupId,
  splitGroup,
  updateGroup,
} from "./layout";
import type { Buffer, Group, LayoutNode } from "./layout";

export interface Workspace {
  buffers: Buffer[]; // loaded notes, keyed by name
  layout: LayoutNode; // the pane tree
  focusedId: string; // id of the pane with the keyboard
}

// ---- Reading ---------------------------------------------------------------

/** The focused pane, falling back to the first one if the id went stale. */
export function focusedGroup(ws: Workspace): Group {
  return findGroup(ws.layout, ws.focusedId) ?? firstGroup(ws.layout);
}

/** The note showing in the focused pane, if any — the note, whether the tab
 *  in front is its editor or its preview. */
export function activeName(ws: Workspace): string | null {
  const id = focusedGroup(ws).active;
  return id ? noteOf(id) : null;
}

/** Notes no pane has open any more. Their buffers are dropped: an unreferenced
 *  buffer is memory nobody can reach, and a stale one would be resurrected by
 *  the next save. */
export function gcBuffers(layout: LayoutNode, buffers: Buffer[]): Buffer[] {
  const referenced = new Set(allGroups(layout).flatMap((g) => g.tabs.map(noteOf)));
  return buffers.filter((b) => referenced.has(b.name));
}

/** A workspace with a new tree, minus the buffers it orphaned. */
function withLayout(ws: Workspace, layout: LayoutNode): Workspace {
  return { ...ws, layout, buffers: gcBuffers(layout, ws.buffers) };
}

// ---- Buffer contents -------------------------------------------------------
// These take and return the buffer list rather than a whole workspace, so they
// compose with a functional setState. Typing goes through editBuffer on every
// keystroke, and reading the list back out of a ref would drop an edit made
// before the next render.

/** Record a typed edit. The buffer goes dirty; autosave is the caller's job.
 *
 *  Typing is also what clears the marks left by an external reload — the one
 *  rule: nothing else does it, not clicking the tab and not arriving by
 *  keyboard, because neither of those means you read anything. A conflict is
 *  deliberately *not* cleared: it is a decision, and typing is not an answer
 *  to it. */
export function editBuffer(buffers: Buffer[], name: string, content: string): Buffer[] {
  return buffers.map((b) =>
    b.name === name ? { ...b, content, dirty: true, changed: undefined } : b
  );
}

/** Mark a buffer as written to disk. `written` is the exact text that reached
 *  the file, which becomes the new disk baseline.
 *
 *  It also decides `dirty` by comparing, rather than clearing it: a save is
 *  awaited, and a keystroke that lands during that await produced content the
 *  write did not carry. Clearing unconditionally called that saved. */
export function markSaved(buffers: Buffer[], name: string, written: string): Buffer[] {
  return buffers.map((b) =>
    b.name === name ? { ...b, disk: written, dirty: b.content !== written } : b
  );
}

/** Take in what's on disk after someone else changed it — a git pull, another
 *  machine, another editor. The buffer comes back *clean*: this is not the
 *  user's edit, and leaving it dirty would have autosave write the old content
 *  straight back over the new. */
export function reloadBuffer(
  buffers: Buffer[],
  name: string,
  content: string,
  changed: number[] = []
): Buffer[] {
  return buffers.map((b) =>
    b.name === name
      ? {
          ...b,
          content,
          disk: content,
          dirty: false,
          changed: changed.length ? changed : undefined,
        }
      : b
  );
}

/** The file changed on disk while this buffer had unsaved edits. Both versions
 *  are kept — the buffer stays as the user left it, the disk text rides along
 *  — until they choose. */
export function markConflict(buffers: Buffer[], name: string, disk: string): Buffer[] {
  // The baseline moves too: Parker has now seen this text in the file, so a
  // second event carrying the same content is not a second change.
  return buffers.map((b) =>
    b.name === name ? { ...b, disk, conflict: { disk } } : b
  );
}

/** Answer a conflict. Taking the disk version replaces the buffer and marks the
 *  lines that moved, exactly as a plain reload would; keeping yours drops the
 *  disk text and leaves the buffer dirty, so autosave writes it out. */
export function resolveConflict(
  buffers: Buffer[],
  name: string,
  take: "disk" | "mine",
  changed: number[] = []
): Buffer[] {
  return buffers.map((b) => {
    if (b.name !== name || !b.conflict) return b;
    if (take === "mine") return { ...b, conflict: undefined };
    return {
      ...b,
      content: b.conflict.disk,
      disk: b.conflict.disk,
      dirty: false,
      conflict: undefined,
      changed: changed.length ? changed : undefined,
    };
  });
}

/** What to do about a note whose file just changed.
 *
 *  The watcher fires on every write to the folder, Parker's own autosaves
 *  included, so the first question is whether anything actually changed — and
 *  that is answered against the disk baseline, never against the buffer. A
 *  buffer differing from the file is the ordinary state of unsaved typing.
 *
 *  Only once the file really moved does the user's work matter: unsaved edits
 *  mean two versions exist and Parker must not pick one. */
export type DiskChange = "nothing" | "reload" | "conflict";

/** What Parker last put in a file, and how many times it has written it. App
 *  records this the moment a write returns, outside React state. */
export interface OwnWrite {
  text: string;
  seq: number;
}

/** Is this disk text Parker's own writing coming back?
 *
 *  The disk baseline in the buffer answers that most of the time, but it is
 *  React state and so lags the write in two ways the watcher can catch it out:
 *
 *   - the text was written and the baseline has not re-rendered yet;
 *   - the read straddled a save, so it came back older than the file now is —
 *     `seq` moved while it was in flight.
 *
 *  Either way there is nothing from outside to react to. The second case needs
 *  no retry: the save that overtook the read changed the file, so the watcher
 *  fires again with the settled text.
 */
export function isOwnWrite(
  mine: OwnWrite | undefined,
  disk: string,
  seqAtRead: number
): boolean {
  if (!mine) return false;
  return mine.text === disk || mine.seq !== seqAtRead;
}

export function classifyDiskChange(buf: Buffer, disk: string): DiskChange {
  if (disk === buf.disk) return "nothing";
  if (buf.dirty || buf.conflict) return "conflict";
  return "reload";
}

/** Record (or clear, with undefined) why this note could not be read or written. */
/** A failed read, from Rust's error text: the file isn't there (deleted,
 *  trashed, moved — or mid-replace, which is why callers read twice), or it
 *  couldn't be read for another reason. */
export function readFailure(message: string): "missing" | "cloud" | "error" {
  if (message.startsWith("not-local")) return "cloud";
  return /No such file|os error 2\b/.test(message) ? "missing" : "error";
}

/** A tab for a note that isn't on this Mac yet: no text until it arrives. */
export function cloudBuffer(name: string): Buffer {
  return { name, content: "", disk: "", dirty: false, cloud: "downloading" };
}

/** A note's cloud state: downloading, stuck, or (undefined) here at last. */
export function setCloud(
  buffers: Buffer[],
  name: string,
  cloud: Buffer["cloud"]
): Buffer[] {
  return buffers.map((b) => (b.name === name ? { ...b, cloud } : b));
}

/** The note arrived from iCloud: its text, clean, with nothing marked as
 *  changed — a download isn't an edit. */
export function arrived(buffers: Buffer[], name: string, text: string): Buffer[] {
  return buffers.map((b) =>
    b.name === name
      ? { name, content: text, disk: text, dirty: false }
      : b
  );
}

/** Mark a note's file as gone from disk, or back. */
export function setGone(buffers: Buffer[], name: string, gone: boolean): Buffer[] {
  return buffers.map((b) => (b.name === name ? { ...b, gone: gone || undefined } : b));
}

/** Whether a save may write this note now. Not while two versions wait for
 *  the user, and not while the file is gone: writing would recreate it. */
export function canAutosave(buffer: Buffer | undefined): buffer is Buffer {
  return !!buffer && !buffer.conflict && !buffer.gone && !buffer.cloud;
}

export function setError(
  buffers: Buffer[],
  name: string,
  error: string | undefined
): Buffer[] {
  return buffers.map((b) => (b.name === name ? { ...b, error } : b));
}

/**
 * What a tab's status dot is saying, most serious first.
 *
 * Green is the resting state, and it is stated rather than implied: a tab that
 * says nothing is indistinguishable from a tab whose indicator is broken.
 *
 *   error     something failed, or the file is gone from disk
 *   conflict  two versions exist and only the user can choose
 *   unseen    text arrived from outside and hasn't been read
 *   dirty     your own typing, not yet written
 *   saved     on disk, unchanged
 */
export type TabStatus = "error" | "conflict" | "unseen" | "dirty" | "saved";

export function tabStatus(buffer: Buffer | undefined): TabStatus {
  if (!buffer) return "saved";
  if (buffer.error || buffer.gone) return "error";
  if (buffer.conflict) return "conflict";
  if (buffer.changed?.length) return "unseen";
  if (buffer.dirty) return "dirty";
  return "saved";
}

/** Notes carrying marks from a reload the user has not typed over yet. */
export function unseenChanges(buffers: Buffer[]): string[] {
  return buffers.filter((b) => b.changed?.length).map((b) => b.name);
}

// ---- Tabs ------------------------------------------------------------------

/** Show a tab that's already in the pane, and focus that pane. */
export function selectTab(ws: Workspace, groupId: string, id: string): Workspace {
  return {
    ...ws,
    layout: updateGroup(ws.layout, groupId, { active: id, unselected: false }),
    focusedId: groupId,
  };
}

/** Select no tab, keeping the view: the note in front stays on screen, the
 *  strip just stops marking it. A click on the strip's empty space does
 *  this, and a split from here is born empty instead of taking the tab.
 *  Only selecting a tab ends it — not focus, not a click on the pane's
 *  buttons: the split button is a click on the pane, and the gesture has
 *  to survive exactly that click. */
export function deselectTab(ws: Workspace, groupId: string): Workspace {
  return {
    ...ws,
    layout: updateGroup(ws.layout, groupId, { unselected: true }),
    focusedId: groupId,
  };
}

/** Open a note in a pane: add the tab if it isn't there, make it active, focus
 *  the pane. The buffer is added if the caller loaded one.
 *
 *  One editor per note: a note already open in another pane is shown there
 *  instead of opened again. (Two editors on one note is a thing worth having
 *  one day; until the Editor keeps two cursors apart, this is the rule.) */
export function openNote(
  ws: Workspace,
  groupId: string,
  buffer: Buffer
): Workspace {
  const g = findGroup(ws.layout, groupId);
  if (!g) return ws;
  const buffers = ws.buffers.some((b) => b.name === buffer.name)
    ? ws.buffers
    : [...ws.buffers, buffer];
  const elsewhere = groupWithTab(ws.layout, buffer.name);
  if (elsewhere && elsewhere.id !== groupId) {
    return selectTab({ ...ws, buffers }, elsewhere.id, buffer.name);
  }
  const tabs = g.tabs.includes(buffer.name) ? g.tabs : [...g.tabs, buffer.name];
  return {
    buffers,
    layout: updateGroup(ws.layout, groupId, { tabs, active: buffer.name }),
    focusedId: groupId,
  };
}

/** Open a note at a place in the strip — a file dropped on a tab takes that
 *  tab's place, as a dragged tab would. Opening appends, so the tab is then
 *  moved. `index` past the end, or undefined, means the end: plain openNote. */
export function openNoteAt(
  ws: Workspace,
  groupId: string,
  buffer: Buffer,
  index?: number
): Workspace {
  const opened = openNote(ws, groupId, buffer);
  if (index === undefined) return opened;
  return dropTab(opened, { from: groupId, name: buffer.name }, groupId, index);
}

/** Close a tab. The pane keeps its neighbours; a pane left with nothing
 *  closes, unless it is the only one — then it simply stays empty. It used to
 *  ask the caller for a fresh note instead, on the theory that there had to be
 *  something to edit, and every close of the last tab left an Untitled file on
 *  disk that nobody asked for. An empty pane is a fine place to be: it says
 *  how to get a note, and does not make one. */
export function closeTab(ws: Workspace, groupId: string, name: string): Workspace {
  const g = findGroup(ws.layout, groupId);
  if (!g || !g.tabs.includes(name)) return ws;

  const idx = g.tabs.indexOf(name);
  const remaining = g.tabs.filter((t) => t !== name);

  // Neighbours left: the one that took its place becomes active.
  if (remaining.length > 0) {
    const active =
      g.active === name ? remaining[Math.min(idx, remaining.length - 1)] : g.active;
    return withLayout(ws, updateGroup(ws.layout, groupId, { tabs: remaining, active }));
  }

  // The pane is empty. The last one standing stays, empty.
  if (allGroups(ws.layout).length <= 1) {
    return withLayout(ws, updateGroup(ws.layout, groupId, { tabs: [], active: null }));
  }

  // One of several panes: it goes.
  const layout = removeGroup(ws.layout, groupId)!;
  return { ...withLayout(ws, layout), focusedId: firstGroup(layout).id };
}

/** Move the active tab within its pane. Clamped at the ends — it does not wrap,
 *  because dragging a tab off the end is not what the keystroke means. */
export function moveTab(ws: Workspace, delta: number): Workspace {
  const g = focusedGroup(ws);
  const name = g.active;
  if (!name) return ws;
  const i = g.tabs.indexOf(name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= g.tabs.length) return ws;
  const tabs = [...g.tabs];
  [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  return { ...ws, layout: updateGroup(ws.layout, g.id, { tabs }) };
}

/** ⌘1–9: the nth tab of the focused pane. Out of range does nothing. */
export function selectTabByIndex(ws: Workspace, i: number): Workspace {
  const g = focusedGroup(ws);
  const name = g.tabs[i];
  if (!name) return ws;
  return { ...ws, layout: updateGroup(ws.layout, g.id, { active: name }) };
}

/** Previous/next tab in the focused pane. Wraps. */
export function selectTabByOffset(ws: Workspace, delta: number): Workspace {
  const g = focusedGroup(ws);
  if (g.tabs.length === 0) return ws;
  const i = g.tabs.findIndex((t) => t === g.active);
  const name = g.tabs[(i + delta + g.tabs.length) % g.tabs.length];
  return { ...ws, layout: updateGroup(ws.layout, g.id, { active: name }) };
}

/** Drop a dragged tab: reorder inside a pane, or move it to another one. */
export function dropTab(
  ws: Workspace,
  source: { from: string; name: string },
  toGroupId: string,
  toIndex: number
): Workspace {
  const { from, name } = source;

  if (from === toGroupId) {
    const g = findGroup(ws.layout, toGroupId);
    if (!g) return ws;
    const fromIdx = g.tabs.indexOf(name);
    if (fromIdx < 0) return ws;
    const tabs = g.tabs.filter((t) => t !== name);
    tabs.splice(dropIndex(toIndex), 0, name);
    return { ...ws, layout: updateGroup(ws.layout, toGroupId, { tabs }) };
  }

  const src = findGroup(ws.layout, from);
  const dst = findGroup(ws.layout, toGroupId);
  if (!src || !dst) return ws;

  const srcTabs = src.tabs.filter((t) => t !== name);
  const srcActive =
    src.active === name
      ? srcTabs[Math.min(src.tabs.indexOf(name), srcTabs.length - 1)] ?? null
      : src.active;
  const dstTabs = dst.tabs.filter((t) => t !== name);
  dstTabs.splice(dropIndex(toIndex), 0, name);

  let layout = updateGroup(ws.layout, toGroupId, { tabs: dstTabs, active: name });
  layout =
    srcTabs.length === 0
      ? removeGroup(layout, from)! // source emptied → collapse it
      : updateGroup(layout, from, { tabs: srcTabs, active: srcActive });
  return { ...ws, layout, focusedId: toGroupId };
}

// Only the lower bound needs guarding: splice already treats an index past
// the end as "at the end", but a negative one counts back from it, which
// would drop the tab somewhere nobody aimed at.
const dropIndex = (i: number) => Math.max(i, 0);

// ---- Panes -----------------------------------------------------------------

/** Split a pane. The selected tab moves into the new pane — even when it was
 *  the only one, leaving the original empty. Never a duplicate: the same note
 *  open twice in one window is two editors fighting over one buffer. */
export function splitPane(
  ws: Workspace,
  groupId: string,
  dir: "row" | "col"
): Workspace {
  const g = findGroup(ws.layout, groupId);
  if (!g) return ws;

  // The selected tab goes across to the new pane — but never the last one:
  // a pane that would be left empty keeps its note, and the new pane is born
  // empty beside it. The new pane is always to the right, or below; what
  // moves is the only variable, and a split must not read as "my pane
  // went away".
  let base = ws.layout;
  let fresh: Group;
  if (g.active && !g.unselected && g.tabs.length > 1) {
    const active = g.active;
    const idx = g.tabs.indexOf(active);
    const remaining = g.tabs.filter((t) => t !== active);
    base = updateGroup(ws.layout, groupId, {
      tabs: remaining,
      active: remaining.length
        ? remaining[Math.min(idx, remaining.length - 1)]
        : null,
    });
    fresh = makeGroup([active], active);
  } else {
    // An empty pane, a pane with no tab selected, or one holding a single
    // note: the new pane is born empty.
    fresh = makeGroup([], null);
    if (g.unselected) base = updateGroup(base, groupId, { unselected: false });
  }

  return {
    ...ws,
    layout: splitGroup(base, groupId, dir, fresh),
    focusedId: fresh.id,
  };
}

/** Open a note's preview beside its editor: a new pane to the right holding
 *  the preview tab, focus staying with the editor so you keep typing. One
 *  preview per note: if it is open somewhere already, that pane shows it. */
export function previewToSide(ws: Workspace, groupId: string): Workspace {
  const g = findGroup(ws.layout, groupId);
  if (!g || !g.active) return ws;
  const name = noteOf(g.active);
  const id = previewTab(name);
  const existing = groupWithTab(ws.layout, id);
  if (existing) return { ...selectTab(ws, existing.id, id), focusedId: groupId };
  const preview = makeGroup([id], id);
  return {
    ...ws,
    layout: splitGroup(ws.layout, groupId, "row", preview),
    focusedId: groupId,
  };
}

/** Close a pane and everything in it. The last pane can't be closed. */
export function closePane(ws: Workspace, groupId: string): Workspace {
  const g = findGroup(ws.layout, groupId);
  if (!g || allGroups(ws.layout).length <= 1) return ws;
  const layout = removeGroup(ws.layout, groupId)!;
  return { ...withLayout(ws, layout), focusedId: firstGroup(layout).id };
}

/** Merge a pane into its neighbour: the tabs move over and the pane collapses.
 *  Like closing it, but keeping the notes open. */
export function mergePane(ws: Workspace, groupId: string): Workspace {
  const g = findGroup(ws.layout, groupId);
  const sibId = g ? siblingGroupId(ws.layout, groupId) : null;
  const sib = sibId ? findGroup(ws.layout, sibId) : null;
  if (!g || !sibId || !sib) return ws;

  const tabs = [...sib.tabs, ...g.tabs.filter((t) => !sib.tabs.includes(t))];
  let layout = updateGroup(ws.layout, sibId, {
    tabs,
    active: sib.active ?? g.active,
  });
  layout = removeGroup(layout, groupId)!;
  return { ...withLayout(ws, layout), focusedId: sibId };
}

/** Cycle focus through the panes, in tree order. Wraps. */
export function focusPaneByOffset(ws: Workspace, delta: number): Workspace {
  const groups = allGroups(ws.layout);
  if (groups.length < 2) return ws;
  const i = groups.findIndex((g) => g.id === ws.focusedId);
  const next = groups[(Math.max(i, 0) + delta + groups.length) % groups.length];
  return { ...ws, focusedId: next.id };
}

/** Flip a pane between the editor and the markdown preview. */
export function toggleMode(ws: Workspace, groupId: string): Workspace {
  const g = findGroup(ws.layout, groupId);
  if (!g || !g.active) return ws;
  const from = g.active;
  const to = isPreviewTab(from) ? noteOf(from) : previewTab(noteOf(from));
  // The tab we are turning into may exist in another pane already: it comes
  // here, so the note keeps one editor and one preview in the workspace.
  let layout = ws.layout;
  const holder = groupWithTab(layout, to);
  if (holder && holder.id !== groupId) {
    const rest = holder.tabs.filter((t) => t !== to);
    layout = updateGroup(layout, holder.id, {
      tabs: rest,
      active: holder.active === to ? rest[0] ?? null : holder.active,
    });
  }
  const here = findGroup(layout, groupId)!;
  const tabs = here.tabs.includes(to)
    ? here.tabs.filter((t) => t !== from) // both were here: the other one stays
    : here.tabs.map((t) => (t === from ? to : t));
  return { ...ws, layout: updateGroup(layout, groupId, { tabs, active: to }) };
}

// ---- Notes appearing and disappearing --------------------------------------

/** A note is gone (trashed, or deleted outside the app). Drop its buffer and
 *  close it in every pane that had it, leaving the panes themselves alone —
 *  a pane going empty here is not a pane the user asked to close. */
export function forgetNote(ws: Workspace, name: string): Workspace {
  let layout = ws.layout;
  for (const g of allGroups(ws.layout)) {
    if (!g.tabs.some((t) => noteOf(t) === name)) continue;
    const idx = g.tabs.findIndex((t) => noteOf(t) === name);
    const remaining = g.tabs.filter((t) => noteOf(t) !== name);
    // The tab in front may be the note's preview: the note is what is gone.
    const active =
      g.active && noteOf(g.active) === name
        ? remaining[Math.min(idx, remaining.length - 1)] ?? null
        : g.active;
    layout = updateGroup(layout, g.id, { tabs: remaining, active });
  }
  return {
    ...ws,
    layout,
    buffers: ws.buffers.filter((b) => b.name !== name),
  };
}

/** A note was renamed. It keeps its place in every pane that has it open. */
export function renameNote(ws: Workspace, from: string, to: string): Workspace {
  const rename = (node: LayoutNode): LayoutNode =>
    node.kind === "group"
      ? {
          ...node,
          tabs: node.tabs.map((t) => (t === from ? to : t === previewTab(from) ? previewTab(to) : t)),
          active:
            node.active === from
              ? to
              : node.active === previewTab(from)
                ? previewTab(to)
                : node.active,
        }
      : { ...node, children: node.children.map(rename) };
  return {
    ...ws,
    layout: rename(ws.layout),
    buffers: ws.buffers.map((b) => (b.name === from ? { ...b, name: to } : b)),
  };
}
