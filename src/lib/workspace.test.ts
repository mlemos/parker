import { describe, expect, it } from "vitest";
import { makeGroup, newId, allGroups, findGroup } from "./layout.ts";
import type { Buffer, Group, LayoutNode, SplitNode } from "./layout.ts";
import * as ws from "./workspace.ts";
import type { Workspace } from "./workspace.ts";

// ---- Fixtures --------------------------------------------------------------

const buf = (name: string, content = "", dirty = false): Buffer => ({
  name,
  content,
  dirty,
});

const split = (dir: "row" | "col", children: LayoutNode[]): SplitNode => ({
  id: newId("s"),
  kind: "split",
  dir,
  children,
  sizes: children.map(() => 1 / children.length),
});

/** One pane with three notes open, the first active. */
function single() {
  const g = makeGroup(["a.md", "b.md", "c.md"], "a.md");
  const w: Workspace = {
    buffers: [buf("a.md"), buf("b.md"), buf("c.md")],
    layout: g,
    focusedId: g.id,
  };
  return { w, g };
}

/** Two panes side by side: left has a+b (a active), right has c. */
function pair() {
  const left = makeGroup(["a.md", "b.md"], "a.md");
  const right = makeGroup(["c.md"], "c.md");
  const w: Workspace = {
    buffers: [buf("a.md"), buf("b.md"), buf("c.md")],
    layout: split("row", [left, right]),
    focusedId: left.id,
  };
  return { w, left, right };
}

const tabsOf = (w: Workspace, id: string) => findGroup(w.layout, id)!.tabs;
const groupAt = (w: Workspace, i: number) => allGroups(w.layout)[i] as Group;
const names = (w: Workspace) => w.buffers.map((b) => b.name);

// ---- Buffer contents -------------------------------------------------------

describe("buffer contents", () => {
  it("marks a typed edit dirty", () => {
    const out = ws.editBuffer([buf("a.md", "old")], "a.md", "new");
    expect(out[0]).toMatchObject({ content: "new", dirty: true });
  });

  it("leaves other buffers alone", () => {
    const before = [buf("a.md"), buf("b.md")];
    const after = ws.editBuffer(before, "a.md", "x");
    expect(after[1]).toBe(before[1]);
  });

  it("ignores a name it doesn't have", () => {
    expect(ws.editBuffer([buf("a.md")], "gone.md", "x")[0].dirty).toBe(false);
  });

  it("clears dirty once the note is written", () => {
    expect(ws.markSaved([buf("a.md", "x", true)], "a.md")[0].dirty).toBe(false);
  });

  // Autosave writes any dirty buffer back. If a reload from disk left the
  // buffer dirty, the next autosave would put the *old* content straight back
  // over what git (or another machine) just brought in.
  it("takes an external change in clean, so autosave can't undo it", () => {
    const out = ws.reloadBuffer([buf("a.md", "mine", false)], "a.md", "theirs");
    expect(out[0]).toMatchObject({ content: "theirs", dirty: false });
  });
});

describe("gcBuffers", () => {
  it("drops buffers no pane has open", () => {
    const g = makeGroup(["a.md"], "a.md");
    expect(ws.gcBuffers(g, [buf("a.md"), buf("gone.md")]).map((b) => b.name)).toEqual([
      "a.md",
    ]);
  });

  it("keeps a note open in another pane", () => {
    const { w } = pair();
    expect(ws.gcBuffers(w.layout, w.buffers)).toHaveLength(3);
  });
});

// ---- Tabs ------------------------------------------------------------------

describe("selectTab", () => {
  it("makes the tab active and focuses its pane", () => {
    const { w, right } = pair();
    const out = ws.selectTab(w, right.id, "c.md");
    expect(out.focusedId).toBe(right.id);
    expect(findGroup(out.layout, right.id)!.active).toBe("c.md");
  });

  // Preview is a view of the note you are on, not a mode the pane sits in.
  it("drops back to the editor when the note changes", () => {
    const g = makeGroup(["a.md", "b.md"], "a.md", "preview");
    const w: Workspace = { buffers: [buf("a.md"), buf("b.md")], layout: g, focusedId: g.id };
    expect((ws.selectTab(w, g.id, "b.md").layout as Group).mode).toBe("edit");
  });

  it("stays in preview when you re-select the note already showing", () => {
    const g = makeGroup(["a.md"], "a.md", "preview");
    const w: Workspace = { buffers: [buf("a.md")], layout: g, focusedId: g.id };
    expect((ws.selectTab(w, g.id, "a.md").layout as Group).mode).toBe("preview");
  });
});

describe("openNote", () => {
  it("adds the tab, the buffer, and the focus", () => {
    const { w, right } = pair();
    const out = ws.openNote(w, right.id, buf("new.md", "hello"));
    expect(tabsOf(out, right.id)).toEqual(["c.md", "new.md"]);
    expect(findGroup(out.layout, right.id)!.active).toBe("new.md");
    expect(out.focusedId).toBe(right.id);
    expect(names(out)).toContain("new.md");
  });

  it("does not open a second copy of a tab already there", () => {
    const { w, g } = single();
    const out = ws.openNote(w, g.id, buf("b.md"));
    expect(tabsOf(out, g.id)).toEqual(["a.md", "b.md", "c.md"]);
    expect(out.buffers).toHaveLength(3);
  });

  // The buffer already loaded is the one with the user's unsaved edits in it.
  it("keeps the loaded buffer rather than the one passed in", () => {
    const { w, g } = single();
    const out = ws.openNote(
      { ...w, buffers: [buf("a.md", "unsaved", true), buf("b.md"), buf("c.md")] },
      g.id,
      buf("a.md", "from disk")
    );
    expect(out.buffers[0]).toMatchObject({ content: "unsaved", dirty: true });
  });

  it("ignores a pane that isn't there", () => {
    const { w } = single();
    expect(ws.openNote(w, "ghost", buf("new.md"))).toBe(w);
  });
});

describe("closeTab", () => {
  it("hands active to the tab that took its place", () => {
    const { w, g } = single();
    const { workspace: out } = ws.closeTab(w, g.id, "a.md");
    expect(tabsOf(out, g.id)).toEqual(["b.md", "c.md"]);
    expect(findGroup(out.layout, g.id)!.active).toBe("b.md");
  });

  it("falls back to the last tab when the closed one was last", () => {
    const { w, g } = single();
    const { workspace: out } = ws.closeTab(ws.selectTab(w, g.id, "c.md"), g.id, "c.md");
    expect(findGroup(out.layout, g.id)!.active).toBe("b.md");
  });

  it("leaves the active tab alone when a different one closes", () => {
    const { w, g } = single();
    const { workspace: out } = ws.closeTab(w, g.id, "c.md");
    expect(findGroup(out.layout, g.id)!.active).toBe("a.md");
  });

  it("forgets the buffer of the note it closed", () => {
    const { w, g } = single();
    const { workspace: out } = ws.closeTab(w, g.id, "b.md");
    expect(names(out)).toEqual(["a.md", "c.md"]);
  });

  it("keeps the buffer when the note is still open in another pane", () => {
    const left = makeGroup(["a.md"], "a.md");
    const right = makeGroup(["a.md"], "a.md");
    const w: Workspace = {
      buffers: [buf("a.md", "shared")],
      layout: split("row", [left, right]),
      focusedId: left.id,
    };
    const { workspace: out } = ws.closeTab(w, left.id, "a.md");
    expect(names(out)).toEqual(["a.md"]);
  });

  // The window must never end up with nothing to edit, and only the caller can
  // create a note — so the machine asks for one instead of inventing it.
  it("asks for a note when the only pane loses its last tab", () => {
    const g = makeGroup(["a.md"], "a.md");
    const w: Workspace = { buffers: [buf("a.md")], layout: g, focusedId: g.id };
    const r = ws.closeTab(w, g.id, "a.md");
    expect(r.needsNote).toBe(true);
    expect((r.workspace.layout as Group).tabs).toEqual([]);
    expect(r.workspace.buffers).toEqual([]);
  });

  it("closes the pane instead when there are others", () => {
    const { w, left, right } = pair();
    const r = ws.closeTab(w, right.id, "c.md");
    expect(r.needsNote).toBe(false);
    expect(allGroups(r.workspace.layout)).toHaveLength(1);
    expect(r.workspace.focusedId).toBe(left.id);
    expect(names(r.workspace)).toEqual(["a.md", "b.md"]);
  });

  it("does nothing for a tab that isn't in the pane", () => {
    const { w, g } = single();
    expect(ws.closeTab(w, g.id, "gone.md").workspace).toBe(w);
    expect(ws.closeTab(w, "ghost", "a.md").workspace).toBe(w);
  });
});

describe("moving between tabs", () => {
  it("swaps the active tab with its neighbour", () => {
    const { w, g } = single();
    expect(tabsOf(ws.moveTab(w, 1), g.id)).toEqual(["b.md", "a.md", "c.md"]);
  });

  it("stops at the ends instead of wrapping", () => {
    const { w, g } = single();
    expect(ws.moveTab(w, -1)).toBe(w);
    expect(ws.moveTab(ws.selectTab(w, g.id, "c.md"), 1).layout).toEqual(
      ws.selectTab(w, g.id, "c.md").layout
    );
  });

  it("picks a tab by position, ignoring one past the end", () => {
    const { w } = single();
    expect((ws.selectTabByIndex(w, 2).layout as Group).active).toBe("c.md");
    expect(ws.selectTabByIndex(w, 9)).toBe(w);
  });

  it("wraps around when cycling", () => {
    const { w, g } = single();
    expect((ws.selectTabByOffset(w, -1).layout as Group).active).toBe("c.md");
    const last = ws.selectTab(w, g.id, "c.md");
    expect((ws.selectTabByOffset(last, 1).layout as Group).active).toBe("a.md");
  });

  it("has nothing to cycle in an empty pane", () => {
    const g = makeGroup([], null);
    const w: Workspace = { buffers: [], layout: g, focusedId: g.id };
    expect(ws.selectTabByOffset(w, 1)).toBe(w);
  });
});

describe("dropTab", () => {
  it("reorders within a pane", () => {
    const { w, g } = single();
    expect(tabsOf(ws.dropTab(w, { from: g.id, name: "c.md" }, g.id, 0), g.id)).toEqual([
      "c.md",
      "a.md",
      "b.md",
    ]);
  });

  it("lands a drop past the end at the end", () => {
    const { w, g } = single();
    expect(tabsOf(ws.dropTab(w, { from: g.id, name: "a.md" }, g.id, 99), g.id)).toEqual([
      "b.md",
      "c.md",
      "a.md",
    ]);
  });

  // A negative index counts back from the end in splice, which would put the
  // tab somewhere nobody aimed at.
  it("lands a negative drop at the front", () => {
    // -1 is the one that matters: splice would read it as "one from the end"
    // and slot the tab second, not first.
    const { w, g } = single();
    expect(tabsOf(ws.dropTab(w, { from: g.id, name: "c.md" }, g.id, -1), g.id)).toEqual([
      "c.md",
      "a.md",
      "b.md",
    ]);
    const { w: w2, left, right } = pair();
    expect(
      tabsOf(ws.dropTab(w2, { from: left.id, name: "a.md" }, right.id, -1), right.id)
    ).toEqual(["a.md", "c.md"]);
  });

  it("moves a tab to another pane and follows it there", () => {
    const { w, left, right } = pair();
    const out = ws.dropTab(w, { from: left.id, name: "b.md" }, right.id, 0);
    expect(tabsOf(out, right.id)).toEqual(["b.md", "c.md"]);
    expect(tabsOf(out, left.id)).toEqual(["a.md"]);
    expect(findGroup(out.layout, right.id)!.active).toBe("b.md");
    expect(out.focusedId).toBe(right.id);
  });

  it("repoints the source's active tab when it was the one dragged", () => {
    const { w, left, right } = pair();
    const out = ws.dropTab(w, { from: left.id, name: "a.md" }, right.id, 0);
    expect(findGroup(out.layout, left.id)!.active).toBe("b.md");
  });

  it("collapses the source pane when its last tab leaves", () => {
    const { w, left, right } = pair();
    const out = ws.dropTab(w, { from: right.id, name: "c.md" }, left.id, 0);
    expect(allGroups(out.layout)).toHaveLength(1);
    expect(tabsOf(out, left.id)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("ignores a drag whose source pane or tab is gone", () => {
    const { w, g } = single();
    expect(ws.dropTab(w, { from: g.id, name: "gone.md" }, g.id, 0)).toBe(w);
    expect(ws.dropTab(w, { from: "ghost", name: "a.md" }, g.id, 0)).toBe(w);
  });
});

// ---- Panes -----------------------------------------------------------------

describe("splitPane", () => {
  // The same note open twice in one window is two editors over one buffer.
  it("moves the active tab across rather than copying it", () => {
    const { w, g } = single();
    const out = ws.splitPane(w, g.id, "row");
    const [before, after] = allGroups(out.layout);
    expect(before.tabs).toEqual(["b.md", "c.md"]);
    expect(after.tabs).toEqual(["a.md"]);
    expect(out.focusedId).toBe(after.id);
  });

  it("leaves the original pane empty when it held only that note", () => {
    const g = makeGroup(["a.md"], "a.md");
    const w: Workspace = { buffers: [buf("a.md")], layout: g, focusedId: g.id };
    const out = ws.splitPane(w, g.id, "col");
    expect(groupAt(out, 0).tabs).toEqual([]);
    expect(groupAt(out, 0).active).toBeNull();
  });

  it("gives an empty pane another empty one", () => {
    const g = makeGroup([], null);
    const w: Workspace = { buffers: [], layout: g, focusedId: g.id };
    const out = ws.splitPane(w, g.id, "row");
    expect(allGroups(out.layout)).toHaveLength(2);
    expect(groupAt(out, 1).tabs).toEqual([]);
  });

  it("ignores a pane that isn't there", () => {
    const { w } = single();
    expect(ws.splitPane(w, "ghost", "row")).toBe(w);
  });
});

describe("previewToSide", () => {
  it("mirrors the note and leaves the keyboard where it was", () => {
    const { w, g } = single();
    const out = ws.previewToSide(w, g.id);
    expect(groupAt(out, 0).tabs).toEqual(["a.md", "b.md", "c.md"]); // editor keeps it
    expect(groupAt(out, 1)).toMatchObject({ tabs: ["a.md"], mode: "preview" });
    expect(out.focusedId).toBe(g.id);
  });

  it("has nothing to preview in an empty pane", () => {
    const g = makeGroup([], null);
    const w: Workspace = { buffers: [], layout: g, focusedId: g.id };
    expect(ws.previewToSide(w, g.id)).toBe(w);
  });
});

describe("closePane", () => {
  it("takes the pane and its buffers with it", () => {
    const { w, left, right } = pair();
    const out = ws.closePane(w, left.id);
    expect(allGroups(out.layout)).toHaveLength(1);
    expect(out.focusedId).toBe(right.id);
    expect(names(out)).toEqual(["c.md"]);
  });

  it("refuses to close the last pane", () => {
    const { w, g } = single();
    expect(ws.closePane(w, g.id)).toBe(w);
  });
});

describe("mergePane", () => {
  it("moves the tabs over and collapses the pane", () => {
    const { w, left, right } = pair();
    const out = ws.mergePane(w, right.id);
    expect(allGroups(out.layout)).toHaveLength(1);
    expect(tabsOf(out, left.id)).toEqual(["a.md", "b.md", "c.md"]);
    expect(out.focusedId).toBe(left.id);
  });

  it("does not merge a note in twice when both panes had it", () => {
    const left = makeGroup(["a.md", "b.md"], "a.md");
    const right = makeGroup(["b.md"], "b.md");
    const w: Workspace = {
      buffers: [buf("a.md"), buf("b.md")],
      layout: split("row", [left, right]),
      focusedId: right.id,
    };
    expect(tabsOf(ws.mergePane(w, right.id), left.id)).toEqual(["a.md", "b.md"]);
  });

  it("keeps the surviving pane's own active tab", () => {
    const { w, left, right } = pair();
    expect(findGroup(ws.mergePane(w, right.id).layout, left.id)!.active).toBe("a.md");
  });

  it("has no neighbour to merge into when it is the only pane", () => {
    const { w, g } = single();
    expect(ws.mergePane(w, g.id)).toBe(w);
  });
});

describe("focusPaneByOffset", () => {
  it("cycles and wraps", () => {
    const { w, right } = pair();
    expect(ws.focusPaneByOffset(w, 1).focusedId).toBe(right.id);
    expect(ws.focusPaneByOffset(w, -1).focusedId).toBe(right.id);
  });

  it("does nothing with a single pane", () => {
    const { w } = single();
    expect(ws.focusPaneByOffset(w, 1)).toBe(w);
  });
});

describe("toggleMode", () => {
  it("flips between the editor and the preview", () => {
    const { w, g } = single();
    const preview = ws.toggleMode(w, g.id);
    expect((preview.layout as Group).mode).toBe("preview");
    expect((ws.toggleMode(preview, g.id).layout as Group).mode).toBe("edit");
  });
});

// ---- Notes appearing and disappearing --------------------------------------

describe("forgetNote", () => {
  it("closes the note in every pane and drops its buffer", () => {
    const left = makeGroup(["a.md", "b.md"], "b.md");
    const right = makeGroup(["b.md", "c.md"], "c.md");
    const w: Workspace = {
      buffers: [buf("a.md"), buf("b.md"), buf("c.md")],
      layout: split("row", [left, right]),
      focusedId: left.id,
    };
    const out = ws.forgetNote(w, "b.md");
    expect(tabsOf(out, left.id)).toEqual(["a.md"]);
    expect(tabsOf(out, right.id)).toEqual(["c.md"]);
    expect(findGroup(out.layout, left.id)!.active).toBe("a.md");
    expect(names(out)).toEqual(["a.md", "c.md"]);
  });

  // A note vanishing is not the user asking to close a pane; the panes stay
  // where they are, empty if it comes to that.
  it("leaves an emptied pane standing", () => {
    const { w, left, right } = pair();
    const out = ws.forgetNote(w, "c.md");
    expect(allGroups(out.layout)).toHaveLength(2);
    expect(tabsOf(out, right.id)).toEqual([]);
    expect(findGroup(out.layout, right.id)!.active).toBeNull();
    expect(tabsOf(out, left.id)).toEqual(["a.md", "b.md"]);
  });
});

describe("renameNote", () => {
  it("follows the note through every pane that has it open", () => {
    const left = makeGroup(["a.md", "b.md"], "b.md");
    const right = makeGroup(["b.md"], "b.md");
    const w: Workspace = {
      buffers: [buf("a.md"), buf("b.md", "text", true)],
      layout: split("row", [left, right]),
      focusedId: left.id,
    };
    const out = ws.renameNote(w, "b.md", "renamed.md");
    expect(tabsOf(out, left.id)).toEqual(["a.md", "renamed.md"]);
    expect(tabsOf(out, right.id)).toEqual(["renamed.md"]);
    expect(findGroup(out.layout, left.id)!.active).toBe("renamed.md");
    expect(findGroup(out.layout, right.id)!.active).toBe("renamed.md");
  });

  it("carries the buffer's unsaved content to the new name", () => {
    const { w } = single();
    const out = ws.renameNote(
      { ...w, buffers: [buf("a.md", "draft", true), buf("b.md"), buf("c.md")] },
      "a.md",
      "z.md"
    );
    expect(out.buffers[0]).toMatchObject({ name: "z.md", content: "draft", dirty: true });
  });
});

// ---- Sequences -------------------------------------------------------------
// Single steps are easy to get right one at a time; the bugs live in what the
// state looks like several moves later.

describe("a working session", () => {
  it("survives split, drop, merge and close without losing a note", () => {
    const { w, g } = single();
    let s: Workspace = w;
    s = ws.splitPane(s, g.id, "row"); // a.md moves right
    const [l, r] = allGroups(s.layout);
    s = ws.dropTab(s, { from: l.id, name: "b.md" }, r.id, 0); // b.md follows
    expect(tabsOf(s, r.id)).toEqual(["b.md", "a.md"]);
    expect(tabsOf(s, l.id)).toEqual(["c.md"]);

    s = ws.mergePane(s, r.id); // fold it all back into one pane
    expect(allGroups(s.layout)).toHaveLength(1);
    expect(groupAt(s, 0).tabs).toEqual(["c.md", "b.md", "a.md"]);
    expect(names(s).sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("keeps focus on a pane that still exists after every step", () => {
    const { w, g } = single();
    let s: Workspace = w;
    s = ws.splitPane(s, g.id, "row");
    s = ws.splitPane(s, s.focusedId, "col");
    s = ws.closePane(s, s.focusedId);
    s = ws.mergePane(s, s.focusedId);
    expect(findGroup(s.layout, s.focusedId)).not.toBeNull();
  });

  it("never leaves a buffer for a note no pane has open", () => {
    const { w, g } = single();
    let s: Workspace = w;
    s = ws.splitPane(s, g.id, "row");
    s = ws.closeTab(s, s.focusedId, "a.md").workspace;
    s = ws.closePane(s, s.focusedId);
    const open = new Set(allGroups(s.layout).flatMap((x) => x.tabs));
    expect(names(s).filter((n) => !open.has(n))).toEqual([]);
  });
});
