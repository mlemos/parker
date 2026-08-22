import { describe, expect, it } from "vitest";
import {
  allGroups,
  allTabNames,
  asLayout,
  centerDivider,
  findGroup,
  firstGroup,
  lastGroup,
  makeGroup,
  mergeDirections,
  neighborGroupId,
  newId,
  pruneLayout,
  removeGroup,
  resizeSplit,
  siblingGroupId,
  splitGroup,
  updateGroup,
  type Group,
  type LayoutNode,
  type SplitNode,
} from "./layout.ts";

// ---- Fixtures -------------------------------------------------------------

const split = (
  dir: "row" | "col",
  children: LayoutNode[],
  sizes?: number[]
): SplitNode => ({
  id: newId("s"),
  kind: "split",
  dir,
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
});

/** A ── B│C quadrant-ish tree: left pane, right column of two. */
function nested() {
  const a = makeGroup(["a.md"], "a.md");
  const b = makeGroup(["b.md"], "b.md");
  const c = makeGroup(["c.md"], "c.md");
  const root = split("row", [a, split("col", [b, c])], [0.7, 0.3]);
  return { a, b, c, root };
}

// ---- asLayout: the session deserializer -----------------------------------
// This one runs against whatever is in session.json — a file from an older
// version, a half-written one, or one edited by hand. Anything it accepts is
// rendered; anything it rejects costs the user their layout but must not throw.

describe("asLayout", () => {
  it("rejects values that aren't a tree", () => {
    for (const junk of [null, undefined, 0, 42, "group", true, [], {}, { kind: "nope" }])
      expect(asLayout(junk)).toBeNull();
  });

  it("accepts a minimal group and fills in the defaults", () => {
    const n = asLayout({ kind: "group", tabs: ["a.md"], active: "a.md" });
    expect(n).toMatchObject({ kind: "group", tabs: ["a.md"], active: "a.md", mode: "edit" });
    expect(typeof n!.id).toBe("string");
  });

  it("drops tab entries that aren't strings", () => {
    const n = asLayout({ kind: "group", tabs: ["a.md", 1, null, {}, "b.md"], active: "a.md" });
    expect((n as Group).tabs).toEqual(["a.md", "b.md"]);
  });

  it("rejects a group whose tabs aren't a list", () => {
    expect(asLayout({ kind: "group", tabs: "a.md", active: "a.md" })).toBeNull();
  });

  it("nulls an active tab that isn't a string", () => {
    expect((asLayout({ kind: "group", tabs: [], active: 7 }) as Group).active).toBeNull();
  });

  it("keeps only 'preview' as a non-default mode", () => {
    const mode = (x: unknown) =>
      (asLayout({ kind: "group", tabs: [], active: null, mode: x }) as Group).mode;
    expect(mode("preview")).toBe("preview");
    expect(mode("edit")).toBe("edit");
    expect(mode("bogus")).toBe("edit");
    expect(mode(undefined)).toBe("edit");
  });

  it("rejects a split with no children", () => {
    expect(asLayout({ kind: "split", dir: "row", children: [], sizes: [] })).toBeNull();
  });

  it("rejects the whole tree when any child is malformed", () => {
    const n = asLayout({
      kind: "split",
      dir: "row",
      children: [{ kind: "group", tabs: ["a.md"], active: "a.md" }, { kind: "wat" }],
      sizes: [0.5, 0.5],
    });
    expect(n).toBeNull();
  });

  it("replaces sizes that don't match the child count", () => {
    const n = asLayout({
      kind: "split",
      dir: "row",
      children: [
        { kind: "group", tabs: [], active: null },
        { kind: "group", tabs: [], active: null },
      ],
      sizes: [0.9], // one size, two children
    }) as SplitNode;
    expect(n.sizes).toEqual([0.5, 0.5]);
  });

  it("defaults an unknown direction to a row", () => {
    const n = asLayout({
      kind: "split",
      dir: "diagonal",
      children: [{ kind: "group", tabs: [], active: null }],
    }) as SplitNode;
    expect(n.dir).toBe("row");
  });

  it("round-trips a real tree through JSON", () => {
    const { root } = nested();
    const back = asLayout(JSON.parse(JSON.stringify(root)));
    expect(back).toEqual(root);
  });
});

// ---- pruneLayout ----------------------------------------------------------

describe("pruneLayout", () => {
  it("drops tabs whose note is gone and repoints active", () => {
    const g = makeGroup(["a.md", "gone.md", "b.md"], "gone.md");
    const out = pruneLayout(g, new Set(["a.md", "b.md"])) as Group;
    expect(out.tabs).toEqual(["a.md", "b.md"]);
    expect(out.active).toBe("a.md");
  });

  it("leaves a surviving active tab alone", () => {
    const g = makeGroup(["a.md", "gone.md"], "a.md");
    expect((pruneLayout(g, new Set(["a.md"])) as Group).active).toBe("a.md");
  });

  it("empties a group whose notes are all gone, keeping the pane", () => {
    const g = makeGroup(["gone.md"], "gone.md");
    const out = pruneLayout(g, new Set()) as Group;
    expect(out.tabs).toEqual([]);
    expect(out.active).toBeNull();
  });

  it("recurses into splits without changing the structure", () => {
    const { root, c } = nested();
    const out = pruneLayout(root, new Set(["a.md", "b.md"])) as SplitNode;
    expect(allGroups(out)).toHaveLength(3);
    expect(findGroup(out, c.id)!.tabs).toEqual([]);
  });
});

// ---- splitGroup -----------------------------------------------------------

describe("splitGroup", () => {
  it("turns a lone group into a two-pane split", () => {
    const a = makeGroup(["a.md"], "a.md");
    const b = makeGroup([], null);
    const out = splitGroup(a, a.id, "row", b) as SplitNode;
    expect(out.kind).toBe("split");
    expect(out.dir).toBe("row");
    expect(out.children).toEqual([a, b]);
    expect(out.sizes).toEqual([0.5, 0.5]);
  });

  it("leaves a group that isn't the target untouched", () => {
    const a = makeGroup(["a.md"], "a.md");
    expect(splitGroup(a, "nope", "row", makeGroup([], null))).toBe(a);
  });

  it("flattens into the parent when the direction matches", () => {
    const a = makeGroup(["a.md"], "a.md");
    const b = makeGroup(["b.md"], "b.md");
    const n = makeGroup([], null);
    const root = split("row", [a, b], [0.6, 0.4]);
    const out = splitGroup(root, a.id, "row", n) as SplitNode;
    expect(out.children).toEqual([a, n, b]);
    // The new pane takes half of what the split target had; the other pane
    // keeps its size, so only the target's column is disturbed.
    expect(out.sizes).toEqual([0.3, 0.3, 0.4]);
  });

  it("wraps the target in a nested split when the direction differs", () => {
    const a = makeGroup(["a.md"], "a.md");
    const b = makeGroup(["b.md"], "b.md");
    const n = makeGroup([], null);
    const root = split("row", [a, b], [0.6, 0.4]);
    const out = splitGroup(root, a.id, "col", n) as SplitNode;
    expect(out.dir).toBe("row");
    expect(out.sizes).toEqual([0.6, 0.4]); // parent untouched
    const wrapped = out.children[0] as SplitNode;
    expect(wrapped.kind).toBe("split");
    expect(wrapped.dir).toBe("col");
    expect(wrapped.children).toEqual([a, n]);
  });

  it("finds a target nested several levels down", () => {
    const { root, c } = nested();
    const n = makeGroup([], null);
    const out = splitGroup(root, c.id, "col", n);
    expect(allGroups(out)).toHaveLength(4);
    expect(findGroup(out, n.id)).not.toBeNull();
  });
});

// ---- removeGroup ----------------------------------------------------------

describe("removeGroup", () => {
  it("returns null when the last pane goes", () => {
    const a = makeGroup(["a.md"], "a.md");
    expect(removeGroup(a, a.id)).toBeNull();
  });

  it("collapses a split down to its surviving child", () => {
    const a = makeGroup(["a.md"], "a.md");
    const b = makeGroup(["b.md"], "b.md");
    const out = removeGroup(split("row", [a, b]), b.id);
    expect(out).toEqual(a);
  });

  it("renormalises the sizes of the panes that remain", () => {
    const a = makeGroup(["a.md"], "a.md");
    const b = makeGroup(["b.md"], "b.md");
    const c = makeGroup(["c.md"], "c.md");
    const out = removeGroup(split("row", [a, b, c], [0.5, 0.25, 0.25]), b.id) as SplitNode;
    expect(out.children).toEqual([a, c]);
    // a stays twice as wide as c, and the fractions still add up to 1.
    expect(out.sizes[0]).toBeCloseTo(2 / 3);
    expect(out.sizes[1]).toBeCloseTo(1 / 3);
  });

  it("does not disturb an ancestor's dividers when a nested pane closes", () => {
    const { root, c } = nested();
    const out = removeGroup(root, c.id) as SplitNode;
    // The right column collapsed into b, but the main 70/30 divider the user
    // dragged is not theirs to reset.
    expect(out.sizes).toEqual([0.7, 0.3]);
  });

  it("leaves the tree alone when the id isn't in it", () => {
    const { root } = nested();
    expect(removeGroup(root, "ghost")).toEqual(root);
  });
});

// ---- Navigation between panes --------------------------------------------

describe("siblingGroupId", () => {
  it("has no sibling when the group is the whole tree", () => {
    const a = makeGroup([], null);
    expect(siblingGroupId(a, a.id)).toBeNull();
  });

  it("prefers the previous sibling", () => {
    const a = makeGroup([], null);
    const b = makeGroup([], null);
    const c = makeGroup([], null);
    const root = split("row", [a, b, c]);
    expect(siblingGroupId(root, b.id)).toBe(a.id);
  });

  it("falls back to the next sibling for the first pane", () => {
    const a = makeGroup([], null);
    const b = makeGroup([], null);
    expect(siblingGroupId(split("row", [a, b]), a.id)).toBe(b.id);
  });

  it("reaches into a neighbouring subtree for the closest pane", () => {
    const { root, a, b } = nested();
    // a's next sibling is the whole right column; the pane nearest a is its
    // first group, not the column node.
    expect(siblingGroupId(root, a.id)).toBe(b.id);
  });
});

describe("neighborGroupId", () => {
  it("steps left and right inside a row", () => {
    const a = makeGroup([], null);
    const b = makeGroup([], null);
    const root = split("row", [a, b]);
    expect(neighborGroupId(root, a.id, "right")).toBe(b.id);
    expect(neighborGroupId(root, b.id, "left")).toBe(a.id);
    expect(neighborGroupId(root, a.id, "left")).toBeNull();
    expect(neighborGroupId(root, a.id, "up")).toBeNull();
  });

  it("crosses axes by walking up to the nearest matching split", () => {
    const { root, a, b, c } = nested();
    expect(neighborGroupId(root, b.id, "down")).toBe(c.id);
    expect(neighborGroupId(root, c.id, "up")).toBe(b.id);
    // Both right-hand panes see the left one; it sees the top of the column.
    expect(neighborGroupId(root, b.id, "left")).toBe(a.id);
    expect(neighborGroupId(root, c.id, "left")).toBe(a.id);
    expect(neighborGroupId(root, a.id, "right")).toBe(b.id);
  });

  it("returns null for an unknown group", () => {
    const { root } = nested();
    expect(neighborGroupId(root, "ghost", "left")).toBeNull();
  });

  it("lists exactly the directions that have a neighbour", () => {
    const { root, a, b, c } = nested();
    expect(mergeDirections(root, a.id)).toEqual(["right"]);
    expect(mergeDirections(root, b.id)).toEqual(["left", "down"]);
    expect(mergeDirections(root, c.id)).toEqual(["left", "up"]);
  });
});

// ---- Sizing ---------------------------------------------------------------

describe("resizeSplit", () => {
  it("shifts space from one pane to its neighbour", () => {
    const root = split("row", [makeGroup([], null), makeGroup([], null)], [0.5, 0.5]);
    const out = resizeSplit(root, root.id, 0, 0.2) as SplitNode;
    expect(out.sizes[0]).toBeCloseTo(0.7);
    expect(out.sizes[1]).toBeCloseTo(0.3);
  });

  it("refuses to squeeze a pane below the minimum", () => {
    const root = split("row", [makeGroup([], null), makeGroup([], null)], [0.5, 0.5]);
    expect(resizeSplit(root, root.id, 0, 0.45)).toBe(root);
    expect(resizeSplit(root, root.id, 0, -0.45)).toBe(root);
  });

  it("only touches the split it was asked about", () => {
    const { root } = nested();
    const inner = root.children[1] as SplitNode;
    const out = resizeSplit(root, inner.id, 0, 0.1) as SplitNode;
    expect(out.sizes).toEqual([0.7, 0.3]);
    expect((out.children[1] as SplitNode).sizes[0]).toBeCloseTo(0.6);
  });
});

describe("centerDivider", () => {
  it("evens out the two panes it separates", () => {
    const root = split("row", [makeGroup([], null), makeGroup([], null)], [0.8, 0.2]);
    expect((centerDivider(root, root.id, 0) as SplitNode).sizes).toEqual([0.5, 0.5]);
  });

  it("leaves the rest of a wider split as it was", () => {
    const root = split("row", [makeGroup([], null), makeGroup([], null), makeGroup([], null)], [0.6, 0.2, 0.2]);
    expect((centerDivider(root, root.id, 0) as SplitNode).sizes).toEqual([0.4, 0.4, 0.2]);
  });
});

// ---- Small helpers --------------------------------------------------------

describe("tree helpers", () => {
  it("walks groups left to right", () => {
    const { root, a, b, c } = nested();
    expect(allGroups(root).map((g) => g.id)).toEqual([a.id, b.id, c.id]);
    expect(firstGroup(root).id).toBe(a.id);
    expect(lastGroup(root).id).toBe(c.id);
  });

  it("dedupes the same note open in two panes", () => {
    const root = split("row", [makeGroup(["a.md", "b.md"], "a.md"), makeGroup(["b.md"], "b.md")]);
    expect(allTabNames(root)).toEqual(["a.md", "b.md"]);
  });

  it("patches one group and copies the rest", () => {
    const { root, b, c } = nested();
    const out = updateGroup(root, b.id, { active: "z.md", mode: "preview" });
    expect(findGroup(out, b.id)).toMatchObject({ active: "z.md", mode: "preview" });
    expect(findGroup(out, c.id)).toEqual(c);
  });

  it("finds nothing for an id that isn't there", () => {
    expect(findGroup(nested().root, "ghost")).toBeNull();
  });

  it("mints ids that can't collide with restored ones", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("g")));
    expect(ids.size).toBe(500);
  });
});
