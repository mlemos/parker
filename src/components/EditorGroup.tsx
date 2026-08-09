import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import { EditorView, Prec } from "@uiw/react-codemirror";
import { languageForName } from "../lib/lang";
import { todoHighlighter } from "../lib/todo";
import type { ThemeDef } from "../lib/themes";
import type { Buffer, Group } from "../lib/layout";
import { RenameInput } from "./RenameInput";

export interface GroupCallbacks {
  onFocus: () => void;
  onSelectTab: (name: string) => void;
  onCloseTab: (name: string) => void;
  onNewTab: () => void;
  onChange: (name: string, value: string) => void;
  onReorder: (from: number, to: number) => void;
  onStartRename: (name: string) => void;
  onCommitRename: (oldName: string, raw: string) => void;
  onCancelRename: () => void;
  onSplit: (dir: "row" | "col") => void;
  onMerge: () => void;
  onCloseGroup: () => void;
}

export function EditorGroup({
  group,
  buffers,
  focused,
  canClose,
  altHeld,
  theme,
  gutterOn,
  wrapOn,
  renamingName,
  cb,
}: {
  group: Group;
  buffers: Buffer[];
  focused: boolean;
  canClose: boolean; // more than one group exists
  altHeld: boolean; // Option held → show merge instead of split
  theme: ThemeDef;
  gutterOn: boolean;
  wrapOn: boolean;
  renamingName: string | null;
  cb: GroupCallbacks;
}) {
  const [langExt, setLangExt] = useState<Extension[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const active = group.active;
  const activeBuf = buffers.find((b) => b.name === active) ?? null;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    languageForName(active).then((ext) => {
      if (alive) setLangExt(ext);
    });
    return () => {
      alive = false;
    };
  }, [active]);

  const cmExtensions: Extension[] = [
    Prec.highest(theme.cm),
    ...(wrapOn ? [EditorView.lineWrapping] : []),
    todoHighlighter,
    ...langExt,
  ];

  return (
    <div
      className={"egroup" + (focused ? " focused" : "")}
      onMouseDown={cb.onFocus}
    >
      <div className="tabstrip">
        <div className="tabs">
          {group.tabs.map((name, i) => {
            const buf = buffers.find((b) => b.name === name);
            const dirty = buf?.dirty ?? false;
            return renamingName === name && focused ? (
              <div key={name} className="tab active editing">
                <RenameInput
                  initial={name}
                  onCommit={(v) => cb.onCommitRename(name, v)}
                  onCancel={cb.onCancelRename}
                />
              </div>
            ) : (
              <button
                key={name}
                className={
                  "tab" +
                  (name === active ? " active" : "") +
                  (i === dragIndex ? " dragging" : "") +
                  (i === overIndex && dragIndex !== null && dragIndex !== i
                    ? " drag-over"
                    : "")
                }
                draggable
                onClick={() => cb.onSelectTab(name)}
                onDoubleClick={() => cb.onStartRename(name)}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) cb.onReorder(dragIndex, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                title={`${name}  —  double-click or F2 to rename`}
              >
                <span className="tab-name">{name}</span>
                <span
                  className={"tab-dot" + (dirty ? " dirty" : "")}
                  aria-hidden
                />
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    cb.onCloseTab(name);
                  }}
                  title="Close (Cmd+W)"
                >
                  ×
                </span>
              </button>
            );
          })}
          <button
            className="tab-new"
            onClick={cb.onNewTab}
            title="New note (Cmd+T)"
          >
            +
          </button>
        </div>
        <div className="group-actions">
          {altHeld && canClose ? (
            // Option held: the split buttons become a merge (unsplit) button.
            <button
              className="group-btn merge"
              onClick={cb.onMerge}
              title="Merge into the neighbouring pane (unsplit)"
              aria-label="Merge pane"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="1.5" />
                <path d="M14 9l-3 3 3 3" />
                <path d="M8 9l3 3-3 3" />
              </svg>
            </button>
          ) : (
            <>
              <button
                className="group-btn"
                onClick={() => cb.onSplit("row")}
                title="Split right (Cmd+\) — hold ⌥ to merge"
                aria-label="Split right"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="1.5" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
              </button>
              <button
                className="group-btn"
                onClick={() => cb.onSplit("col")}
                title="Split down (Cmd+Shift+\) — hold ⌥ to merge"
                aria-label="Split down"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="1.5" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                </svg>
              </button>
            </>
          )}
          {canClose && !altHeld && (
            <button
              className="group-btn"
              onClick={cb.onCloseGroup}
              title="Close this pane"
              aria-label="Close pane"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="editor-wrap">
        {activeBuf && (
          <CodeMirror
            key={`${group.id}:${activeBuf.name}`}
            value={activeBuf.content}
            onChange={(v) => cb.onChange(activeBuf.name, v)}
            theme={theme.mode}
            extensions={cmExtensions}
            height="100%"
            autoFocus={focused}
            basicSetup={{
              lineNumbers: gutterOn,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: gutterOn,
              highlightSelectionMatches: false,
              syntaxHighlighting: false,
            }}
          />
        )}
      </div>
    </div>
  );
}
