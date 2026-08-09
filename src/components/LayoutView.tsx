import { Fragment, useRef } from "react";
import { EditorGroup } from "./EditorGroup";
import type { GroupCallbacks } from "./EditorGroup";
import type { Buffer, Direction, LayoutNode, SplitNode } from "../lib/layout";
import type { ThemeDef } from "../lib/themes";

export interface LayoutHandlers {
  onFocus: (groupId: string) => void;
  onSelectTab: (groupId: string, name: string) => void;
  onCloseTab: (groupId: string, name: string) => void;
  onNewTab: (groupId: string) => void;
  onChange: (name: string, value: string) => void;
  onStartRename: (name: string) => void;
  onCommitRename: (oldName: string, raw: string) => void;
  onCancelRename: () => void;
  onSplit: (groupId: string, dir: "row" | "col") => void;
  onMerge: (groupId: string, dir: Direction) => void;
  onDropTab: (
    source: { from: string; name: string },
    toGroupId: string,
    toIndex: number
  ) => void;
  onCloseGroup: (groupId: string) => void;
  onResize: (splitId: string, index: number, delta: number) => void;
}

interface Common {
  focusedId: string;
  buffers: Buffer[];
  theme: ThemeDef;
  gutterOn: boolean;
  wrapOn: boolean;
  renamingName: string | null;
  multiGroup: boolean;
  altHeld: boolean;
  mergeDirs: Record<string, Direction[]>;
  h: LayoutHandlers;
}

export function LayoutView({
  node,
  ...common
}: { node: LayoutNode } & Common) {
  if (node.kind === "group") {
    const g = node;
    const cb: GroupCallbacks = {
      onFocus: () => common.h.onFocus(g.id),
      onSelectTab: (name) => common.h.onSelectTab(g.id, name),
      onCloseTab: (name) => common.h.onCloseTab(g.id, name),
      onNewTab: () => common.h.onNewTab(g.id),
      onChange: common.h.onChange,
      onStartRename: common.h.onStartRename,
      onCommitRename: common.h.onCommitRename,
      onCancelRename: common.h.onCancelRename,
      onSplit: (dir) => common.h.onSplit(g.id, dir),
      onMerge: (dir) => common.h.onMerge(g.id, dir),
      onDropTab: (source, toIndex) =>
        common.h.onDropTab(source, g.id, toIndex),
      onCloseGroup: () => common.h.onCloseGroup(g.id),
    };
    return (
      <EditorGroup
        group={g}
        buffers={common.buffers}
        focused={common.focusedId === g.id}
        canClose={common.multiGroup}
        altHeld={common.altHeld}
        mergeDirs={common.mergeDirs[g.id] ?? []}
        theme={common.theme}
        gutterOn={common.gutterOn}
        wrapOn={common.wrapOn}
        renamingName={common.renamingName}
        cb={cb}
      />
    );
  }
  return <SplitView node={node} {...common} />;
}

function SplitView({ node, ...common }: { node: SplitNode } & Common) {
  const ref = useRef<HTMLDivElement>(null);

  const startResize = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = node.dir === "row" ? rect.width : rect.height;
    let last = node.dir === "row" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const pos = node.dir === "row" ? ev.clientX : ev.clientY;
      if (total > 0) common.h.onResize(node.id, index, (pos - last) / total);
      last = pos;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={ref} className={"split split-" + node.dir}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <div
              className={"split-divider " + node.dir}
              onPointerDown={startResize(i - 1)}
            />
          )}
          <div
            className="split-cell"
            style={{ flexGrow: node.sizes[i], flexBasis: 0 }}
          >
            <LayoutView node={child} {...common} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
