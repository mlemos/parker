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
  return `${prefix}${_id}`;
}

export function makeGroup(tabs: string[], active: string | null): Group {
  return { id: newId("g"), kind: "group", tabs, active };
}

export function allGroups(node: LayoutNode): Group[] {
  return node.kind === "group"
    ? [node]
    : node.children.flatMap(allGroups);
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
  patch: Partial<Pick<Group, "tabs" | "active">>
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
export function removeGroup(root: LayoutNode, id: string): LayoutNode | null {
  if (root.kind === "group") return root.id === id ? null : root;
  const kids = root.children
    .map((c) => removeGroup(c, id))
    .filter((c): c is LayoutNode => c !== null);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0]; // collapse single-child split
  return { ...root, children: kids, sizes: kids.map(() => 1 / kids.length) };
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
