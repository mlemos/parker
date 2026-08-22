// Editor-group layout: a recursive tree of split nodes and leaf groups, the
// VS Code "editor groups" model. Note *content* lives elsewhere (buffers,
// keyed by name) so the same note open in two groups mirrors live; the tree
// only tracks which notes are open where, and how the panes are arranged.

export interface Buffer {
  name: string; // filename — unique id for the note
  content: string;
  dirty: boolean;
}

export interface Group {
  id: string;
  kind: "group";
  tabs: string[]; // note names open here, in tab order
  active: string | null;
  mode?: "edit" | "preview"; // how the active note is shown (default edit)
}

export interface SplitNode {
  id: string;
  kind: "split";
  dir: "row" | "col"; // row = side by side (V split); col = stacked (H split)
  children: LayoutNode[];
  sizes: number[]; // flex fractions, one per child, sum ~= 1
}

export type LayoutNode = Group | SplitNode;

let _id = 0;
export function newId(prefix = "n"): string {
  _id += 1;
  // Counter + random fragment so ids restored from a saved layout can never
  // collide with freshly-minted ones after a reload.
  return `${prefix}${_id}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeGroup(
  tabs: string[],
  active: string | null,
  mode: "edit" | "preview" = "edit"
): Group {
  return { id: newId("g"), kind: "group", tabs, active, mode };
}

export function allGroups(node: LayoutNode): Group[] {
  return node.kind === "group"
    ? [node]
    : node.children.flatMap(allGroups);
}

// Every note name referenced anywhere in the tree (deduped).
export function allTabNames(node: LayoutNode): string[] {
  return [...new Set(allGroups(node).flatMap((g) => g.tabs))];
}

// Drop tabs whose note no longer exists; keep structure (panes may go empty).
export function pruneLayout(node: LayoutNode, valid: Set<string>): LayoutNode {
  if (node.kind === "group") {
    const tabs = node.tabs.filter((t) => valid.has(t));
    const active =
      node.active && tabs.includes(node.active) ? node.active : tabs[0] ?? null;
    return { ...node, tabs, active };
  }
  return { ...node, children: node.children.map((c) => pruneLayout(c, valid)) };
}

// Validate/normalise a value deserialized from the session into a LayoutNode,
// or null if it's not a well-formed tree.
export function asLayout(x: unknown): LayoutNode | null {
  if (!x || typeof x !== "object") return null;
  const n = x as Record<string, unknown>;
  if (n.kind === "group") {
    if (!Array.isArray(n.tabs)) return null;
    const tabs = n.tabs.filter((t): t is string => typeof t === "string");
    const active = typeof n.active === "string" ? n.active : null;
    const mode = n.mode === "preview" ? "preview" : "edit";
    return {
      id: typeof n.id === "string" ? n.id : newId("g"),
      kind: "group",
      tabs,
      active,
      mode,
    };
  }
  if (n.kind === "split") {
    if (!Array.isArray(n.children) || n.children.length === 0) return null;
    const children = n.children.map(asLayout);
    if (children.some((c) => c === null)) return null;
    const kids = children as LayoutNode[];
    const dir = n.dir === "col" ? "col" : "row";
    const sizes =
      Array.isArray(n.sizes) && n.sizes.length === kids.length
        ? (n.sizes as number[])
        : kids.map(() => 1 / kids.length);
    return {
      id: typeof n.id === "string" ? n.id : newId("s"),
      kind: "split",
      dir,
      children: kids,
      sizes,
    };
  }
  return null;
}

export function findGroup(node: LayoutNode, id: string): Group | null {
  if (node.kind === "group") return node.id === id ? node : null;
  for (const c of node.children) {
    const g = findGroup(c, id);
    if (g) return g;
  }
  return null;
}

export function firstGroup(node: LayoutNode): Group {
  return node.kind === "group" ? node : firstGroup(node.children[0]);
}

// Return a new tree with the group `id` patched (tabs/active). Structure-safe.
export function updateGroup(
  node: LayoutNode,
  id: string,
  patch: Partial<Pick<Group, "tabs" | "active" | "mode">>
): LayoutNode {
  if (node.kind === "group") {
    return node.id === id ? { ...node, ...patch } : node;
  }
  return {
    ...node,
    children: node.children.map((c) => updateGroup(c, id, patch)),
  };
}

// Split the group `targetId` in two, inserting `newGroup` beside it.
// Same-direction parent → flatten (append as a sibling) for clean N-way grids;
// otherwise wrap the target in a fresh cross-direction split.
export function splitGroup(
  root: LayoutNode,
  targetId: string,
  dir: "row" | "col",
  newGroup: Group
): LayoutNode {
  if (root.kind === "group") {
    return root.id === targetId
      ? {
          id: newId("s"),
          kind: "split",
          dir,
          children: [root, newGroup],
          sizes: [0.5, 0.5],
        }
      : root;
  }
  const idx = root.children.findIndex(
    (c) => c.kind === "group" && c.id === targetId
  );
  if (idx >= 0) {
    const children = [...root.children];
    const sizes = [...root.sizes];
    if (root.dir === dir) {
      const half = sizes[idx] / 2;
      sizes.splice(idx, 1, half, half);
      children.splice(idx + 1, 0, newGroup);
      return { ...root, children, sizes };
    }
    children[idx] = {
      id: newId("s"),
      kind: "split",
      dir,
      children: [children[idx], newGroup],
      sizes: [0.5, 0.5],
    };
    return { ...root, children, sizes };
  }
  return {
    ...root,
    children: root.children.map((c) => splitGroup(c, targetId, dir, newGroup)),
  };
}

// Remove the group `id`. Splits left with a single child collapse into it.
// Returns null only if the removed group was the whole tree.
//
// Surviving panes keep their relative widths, renormalised to fill the space
// the closed one left behind. Handing every child an equal share instead would
// reach past the split that actually lost a pane and flatten the dividers the
// user dragged everywhere else in the tree.
export function removeGroup(root: LayoutNode, id: string): LayoutNode | null {
  if (root.kind === "group") return root.id === id ? null : root;
  const even = 1 / root.children.length;
  const kept: { node: LayoutNode; size: number }[] = [];
  root.children.forEach((c, i) => {
    const node = removeGroup(c, id);
    if (node !== null) kept.push({ node, size: root.sizes[i] ?? even });
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].node; // collapse single-child split
  const total = kept.reduce((sum, k) => sum + k.size, 0) || 1;
  return {
    ...root,
    children: kept.map((k) => k.node),
    sizes: kept.map((k) => k.size / total),
  };
}

// The group adjacent to `id` within its immediate parent split (previous
// sibling preferred, else next) — the target for "merge with parent". Null
// when the group is the whole tree (no parent split).
export function siblingGroupId(root: LayoutNode, id: string): string | null {
  const find = (node: LayoutNode): string | null => {
    if (node.kind !== "split") return null;
    const idx = node.children.findIndex(
      (c) => c.kind === "group" && c.id === id
    );
    if (idx >= 0) {
      const prev = node.children[idx - 1];
      const next = node.children[idx + 1];
      if (prev) return lastGroup(prev).id;
      if (next) return firstGroup(next).id;
      return null;
    }
    for (const c of node.children) {
      const r = find(c);
      if (r) return r;
    }
    return null;
  };
  return find(root);
}

export type Direction = "left" | "right" | "up" | "down";

export function lastGroup(node: LayoutNode): Group {
  return node.kind === "group"
    ? node
    : lastGroup(node.children[node.children.length - 1]);
}

// The group spatially adjacent to `id` in a given direction, or null if there's
// no pane that way. Walks up to the nearest ancestor split on the matching axis
// (row for left/right, col for up/down) and steps to the neighbouring subtree,
// picking the group closest to `id` on that side.
export function neighborGroupId(
  root: LayoutNode,
  id: string,
  dir: Direction
): string | null {
  const axis: "row" | "col" =
    dir === "left" || dir === "right" ? "row" : "col";
  const before = dir === "left" || dir === "up";
  const path: { node: SplitNode; i: number }[] = [];
  const build = (node: LayoutNode): boolean => {
    if (node.kind === "group") return node.id === id;
    for (let i = 0; i < node.children.length; i++) {
      if (build(node.children[i])) {
        path.push({ node, i });
        return true;
      }
    }
    return false;
  };
  if (!build(root)) return null;
  for (const { node, i } of path) {
    if (node.dir === axis) {
      const j = before ? i - 1 : i + 1;
      if (j >= 0 && j < node.children.length) {
        const sib = node.children[j];
        return before ? lastGroup(sib).id : firstGroup(sib).id;
      }
    }
  }
  return null;
}

// Directions in which `id` has a neighbour to merge with.
export function mergeDirections(root: LayoutNode, id: string): Direction[] {
  return (["left", "right", "up", "down"] as Direction[]).filter(
    (d) => neighborGroupId(root, id, d) !== null
  );
}

// Center a divider: give the two panes it separates equal size (the rest of
// the split keeps its sizes). Used on a double-click of the divider.
export function centerDivider(
  root: LayoutNode,
  splitId: string,
  index: number
): LayoutNode {
  if (root.kind === "group") return root;
  if (root.id === splitId) {
    const sizes = [...root.sizes];
    const avg = (sizes[index] + sizes[index + 1]) / 2;
    sizes[index] = avg;
    sizes[index + 1] = avg;
    return { ...root, sizes };
  }
  return {
    ...root,
    children: root.children.map((c) => centerDivider(c, splitId, index)),
  };
}

// Resize the divider after child `index` inside a split, shifting `delta`
// (fraction of the split's length) from the next child to this one.
export function resizeSplit(
  root: LayoutNode,
  splitId: string,
  index: number,
  delta: number
): LayoutNode {
  if (root.kind === "group") return root;
  if (root.id === splitId) {
    const sizes = [...root.sizes];
    const min = 0.1;
    const a = sizes[index] + delta;
    const b = sizes[index + 1] - delta;
    if (a < min || b < min) return root;
    sizes[index] = a;
    sizes[index + 1] = b;
    return { ...root, sizes };
  }
  return { ...root, children: root.children.map((c) => resizeSplit(c, splitId, index, delta)) };
}
