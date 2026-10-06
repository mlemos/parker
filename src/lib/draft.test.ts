import { describe, expect, it } from "vitest";
import { draftBuffer, isDraft, newDraftId } from "./draft.ts";
import { displayName, isExternal } from "./external.ts";
import { allGroups, makeGroup, newId, noteOf, previewTab } from "./layout.ts";
import type { Buffer, LayoutNode } from "./layout.ts";
import { isMarkdown } from "./markdown.ts";
import { sessionOf } from "./session.ts";
import * as ws from "./workspace.ts";
import type { Workspace } from "./workspace.ts";

const buf = (name: string, content = ""): Buffer => ({ name, content, disk: content, dirty: false });

describe("a draft's id", () => {
  it("is a draft, and no two are the same", () => {
    const a = newDraftId();
    const b = newDraftId();
    expect(isDraft(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isDraft("Untitled-1.md")).toBe(false);
    expect(isDraft(null)).toBe(false);
  });
  it("keeps its extension, so it is markdown like the note it will be", () => {
    expect(isMarkdown(newDraftId("md"))).toBe(true);
    expect(newDraftId("txt").endsWith(".txt")).toBe(true);
  });
  it("is neither an outside file nor in a folder, and shows as Untitled", () => {
    const id = newDraftId();
    expect(isExternal(id)).toBe(false);
    expect(id.includes("/")).toBe(false);
    expect(displayName(id)).toBe("Untitled");
  });
  it("survives the trip through a preview tab", () => {
    const id = newDraftId();
    expect(noteOf(previewTab(id))).toBe(id);
  });
});

describe("a draft's status", () => {
  it("is draft while empty, dirty once typed into", () => {
    const d = draftBuffer(newDraftId(), "cos/");
    expect(ws.tabStatus(d)).toBe("draft");
    expect(ws.tabStatus({ ...d, content: "x", dirty: true })).toBe("dirty");
  });
});

describe("materialize", () => {
  function withDraft() {
    const id = newDraftId();
    const left = makeGroup(["a.md", id, previewTab(id)], id);
    const right = makeGroup([previewTab(id)], previewTab(id));
    const layout: LayoutNode = { id: newId("s"), kind: "split", dir: "row", children: [left, right], sizes: [0.5, 0.5] };
    const draft: Buffer = { ...draftBuffer(id, "cos/"), content: "hi", dirty: true };
    const w: Workspace = { buffers: [buf("a.md"), draft], layout, focusedId: left.id };
    return { id, w, left };
  }

  it("gives the draft the file's name in every pane, editor and preview", () => {
    const { id, w } = withDraft();
    const after = ws.materialize(w, id, "cos/Untitled-1.md", "hi");
    const [l, r] = allGroups(after.layout);
    expect(l.tabs).toEqual(["a.md", "cos/Untitled-1.md", previewTab("cos/Untitled-1.md")]);
    expect(l.active).toBe("cos/Untitled-1.md");
    expect(r.tabs).toEqual([previewTab("cos/Untitled-1.md")]);
    expect(after.focusedId).toBe(w.focusedId);
  });

  it("leaves a saved note behind, no longer a draft", () => {
    const { id, w } = withDraft();
    const b = ws.materialize(w, id, "cos/Untitled-1.md", "hi").buffers.find((x) => x.name === "cos/Untitled-1.md")!;
    expect(b).toMatchObject({ content: "hi", disk: "hi", dirty: false });
    expect(b.draft).toBeUndefined();
    expect(ws.tabStatus(b)).toBe("saved");
  });

  it("keeps what was typed while the file was being made, unsaved", () => {
    const { id, w } = withDraft();
    const typed = ws.editBuffer(w.buffers, id, "hi there");
    const b = ws.materializeBuffers(typed, id, "cos/Untitled-1.md", "hi").find((x) => x.name === "cos/Untitled-1.md")!;
    expect(b).toMatchObject({ content: "hi there", disk: "hi", dirty: true });
  });

  it("does nothing when the draft is gone", () => {
    const { w } = withDraft();
    expect(ws.materialize(w, "draft:nope.md", "x.md", "")).toBe(w);
  });

  it("an empty draft closed leaves nothing behind", () => {
    const id = newDraftId();
    const g = makeGroup(["a.md", id], id);
    const w: Workspace = { buffers: [buf("a.md"), draftBuffer(id)], layout: g, focusedId: g.id };
    const after = ws.closeTab(w, g.id, id);
    expect(ws.gcBuffers(after.layout, after.buffers).map((b) => b.name)).toEqual(["a.md"]);
  });
});

describe("sessionOf", () => {
  it("leaves drafts out: of the open notes, the panes and the active note", () => {
    const id = newDraftId();
    const left = makeGroup(["a.md", id, previewTab(id)], id);
    const right = makeGroup([id], id);
    const layout: LayoutNode = { id: newId("s"), kind: "split", dir: "row", children: [left, right], sizes: [0.5, 0.5] };
    const s = sessionOf(
      { buffers: [buf("a.md"), draftBuffer(id)], layout, focusedId: left.id, themeId: "night" },
      id
    );
    expect(s.open).toEqual(["a.md"]);
    expect(s.active).toBeNull();
    const [l, r] = allGroups(s.layout as LayoutNode);
    expect(l.tabs).toEqual(["a.md"]);
    expect(l.active).toBe("a.md");
    expect(r.tabs).toEqual([]);
    expect(s.theme).toBe("night");
  });

  it("is the workspace as it is when there are no drafts", () => {
    const g = makeGroup(["a.md", "b.md"], "b.md");
    const s = sessionOf({ buffers: [buf("a.md"), buf("b.md")], layout: g, focusedId: g.id, themeId: "day" }, "b.md");
    expect(s).toMatchObject({ open: ["a.md", "b.md"], active: "b.md", focused: g.id });
    expect(allGroups(s.layout as LayoutNode)[0]).toMatchObject({ tabs: ["a.md", "b.md"], active: "b.md" });
  });
});
