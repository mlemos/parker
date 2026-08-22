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
  makeGroup,
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

/** The note showing in the focused pane, if any. */
export function activeName(ws: Workspace): string | null {
  return focusedGroup(ws).active;
}

/** Notes no pane has open any more. Their buffers are dropped: an unreferenced
 *  buffer is memory nobody can reach, and a stale one would be resurrected by
 *  the next save. */
export function gcBuffers(layout: LayoutNode, buffers: Buffer[]): Buffer[] {
  const referenced = new Set(allGroups(layout).flatMap((g) => g.tabs));
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

/** Record a typed edit. The buffer goes dirty; autosave is the caller's job. */
export function editBuffer(buffers: Buffer[], name: string, content: string): Buffer[] {
  return buffers.map((b) => (b.name === name ? { ...b, content, dirty: true } : b));
}

/** Mark a buffer as written to disk. */
export function markSaved(buffers: Buffer[], name: string): Buffer[] {
  return buffers.map((b) => (b.name === name ? { ...b, dirty: false } : b));
}

/** Take in what's on disk after someone else changed it — a git pull, another
 *  machine, another editor. The buffer comes back *clean*: this is not the
 *  user's edit, and leaving it dirty would have autosave write the old content
 *  straight back over the new. */
export function reloadBuffer(buffers: Buffer[], name: string, content: string): Buffer[] {
  return buffers.map((b) =>
    b.name === name ? { ...b, content, dirty: false } : b
  );
}

// ---- Tabs ------------------------------------------------------------------

/** Show a tab that's already in the pane, and focus that pane. Switching to a
 *  different note returns the pane to the editor, so preview stays a
 *  deliberate view of the current note rather than a sticky mode. */
export function selectTab(ws: Workspace, groupId: string, name: string): Workspace {
  const g = findGroup(ws.layout, groupId);
  const patch =
    g && g.active !== name ? { active: name, mode: "edit" as const } : { active: name };
  return {
    ...ws,
    layout: updateGroup(ws.layout, groupId, patch),
    focusedId: groupId,
  };
}

/** Open a note in a pane: add the tab if it isn't there, make it active, focus
 *  the pane. The buffer is added if the caller loaded one. */
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
  const tabs = g.tabs.includes(buffer.name) ? g.tabs : [...g.tabs, buffer.name];
  return {
    buffers,
    layout: updateGroup(ws.layout, groupId, {
      tabs,
      active: buffer.name,
      mode: "edit",
    }),
    focusedId: groupId,
  };
}

export interface CloseTabResult {
  workspace: Workspace;
  /** The last tab of the only pane just closed. There has to be something to
   *  edit, and only the caller can create a note — it does, then calls
   *  openNote with it. */
  needsNote: boolean;
}

export function closeTab(
  ws: Workspace,
  groupId: string,
  name: string
): CloseTabResult {
  const g = findGroup(ws.layout, groupId);
  if (!g || !g.tabs.includes(name)) return { workspace: ws, needsNote: false };

  const idx = g.tabs.indexOf(name);
  const remaining = g.tabs.filter((t) => t !== name);

  // Neighbours left: the one that took its place becomes active.
  if (remaining.length > 0) {
    const active =
      g.active === name ? remaining[Math.min(idx, remaining.length - 1)] : g.active;
    return {
      workspace: withLayout(
        ws,
        updateGroup(ws.layout, groupId, { tabs: remaining, active })
      ),
      needsNote: false,
    };
  }

  // The pane is empty. The last one standing stays, and gets a fresh note.
  if (allGroups(ws.layout).length <= 1) {
    return {
      workspace: withLayout(
        ws,
        updateGroup(ws.layout, groupId, { tabs: [], active: null })
      ),
      needsNote: true,
    };
  }

  // One of several panes: it goes.
  const layout = removeGroup(ws.layout, groupId)!;
  return {
    workspace: { ...withLayout(ws, layout), focusedId: firstGroup(layout).id },
    needsNote: false,
  };
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

  let base = ws.layout;
  let fresh: Group;
  if (g.active) {
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
    fresh = makeGroup([], null); // splitting an empty pane gives another one
  }

  return {
    ...ws,
    layout: splitGroup(base, groupId, dir, fresh),
    focusedId: fresh.id,
  };
}

/** Open a second view of a note beside its editor. The one deliberate mirror:
 *  the preview pane shows the same buffer, and focus stays with the editor so
 *  you keep typing. */
export function previewToSide(ws: Workspace, groupId: string): Workspace {
  const g = findGroup(ws.layout, groupId);
  if (!g || !g.active) return ws;
  const preview = makeGroup([g.active], g.active, "preview");
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
  if (!g) return ws;
  return {
    ...ws,
    layout: updateGroup(ws.layout, groupId, {
      mode: g.mode === "preview" ? "edit" : "preview",
    }),
  };
}

// ---- Notes appearing and disappearing --------------------------------------

/** A note is gone (trashed, or deleted outside the app). Drop its buffer and
 *  close it in every pane that had it, leaving the panes themselves alone —
 *  a pane going empty here is not a pane the user asked to close. */
export function forgetNote(ws: Workspace, name: string): Workspace {
  let layout = ws.layout;
  for (const g of allGroups(ws.layout)) {
    if (!g.tabs.includes(name)) continue;
    const idx = g.tabs.indexOf(name);
    const remaining = g.tabs.filter((t) => t !== name);
    const active =
      g.active === name
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
          tabs: node.tabs.map((t) => (t === from ? to : t)),
          active: node.active === from ? to : node.active,
        }
      : { ...node, children: node.children.map(rename) };
  return {
    ...ws,
    layout: rename(ws.layout),
    buffers: ws.buffers.map((b) => (b.name === from ? { ...b, name: to } : b)),
  };
}
