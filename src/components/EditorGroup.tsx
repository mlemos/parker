import { useDeferredValue, useEffect, useState } from "react";
import type { Extension } from "@uiw/react-codemirror";
import {
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquaresUnite,
  TriangleAlert,
  Eye,
  Columns2,
  X,
  Plus,
} from "lucide-react";
import { languageForName } from "../lib/lang";
import { tabStatus } from "../lib/workspace";
import type { ThemeDef } from "../lib/themes";
import type { Buffer, Group } from "../lib/layout";
import { isMarkdown } from "../lib/markdown";
import { Editor } from "./Editor";
import { RenameInput } from "./RenameInput";
import { MarkdownPreview } from "./MarkdownPreview";

const TAB_MIME = "application/x-parker-tab";

export interface GroupCallbacks {
  onFocus: () => void;
  onSelectTab: (name: string) => void;
  onCloseTab: (name: string) => void;
  onNewTab: () => void;
  onChange: (name: string, value: string) => void;
  onStartRename: (name: string) => void;
  onCommitRename: (oldName: string, raw: string) => void;
  onCancelRename: () => void;
  onSplit: (dir: "row" | "col") => void;
  onMerge: () => void;
  onToggleMode: () => void;
  onPreviewToSide: () => void;
  onDropTab: (source: { from: string; name: string }, toIndex: number) => void;
  onTabDragStart: () => void;
  onTabDragEnd: () => void;
  onCloseGroup: () => void;
  onResolveConflict: (name: string, take: "disk" | "mine") => void;
}

export function EditorGroup({
  group,
  buffers,
  focused,
  canClose,
  altHeld,
  dragging,
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
  altHeld: boolean; // Option held → each action button shows its alternate
  dragging: boolean; // a tab is being dragged somewhere in the app
  theme: ThemeDef;
  gutterOn: boolean;
  wrapOn: boolean;
  renamingName: string | null;
  cb: GroupCallbacks;
}) {
  const [langExt, setLangExt] = useState<Extension[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false); // a tab is over the body

  const active = group.active;
  const activeBuf = buffers.find((b) => b.name === active) ?? null;
  const isMd = isMarkdown(active);
  const showPreview = group.mode === "preview" && isMd && !!activeBuf;
  // Deferred so a side-by-side preview re-renders at low priority instead of
  // running markdown-it over the whole document inside every keystroke.
  const previewContent = useDeferredValue(activeBuf?.content ?? "");

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

  return (
    <div className={"egroup" + (focused ? " focused" : "")} onMouseDown={cb.onFocus}>
      <div className="tabstrip">
        <div
          className="tabs"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(TAB_MIME)) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(TAB_MIME);
            if (!raw) return;
            e.preventDefault();
            e.stopPropagation();
            try {
              cb.onDropTab(JSON.parse(raw), group.tabs.length);
            } catch {
              /* ignore malformed */
            }
            setDragIndex(null);
            setOverIndex(null);
          }}
        >
          {group.tabs.map((name, i) => {
            const buf = buffers.find((b) => b.name === name);
            // One dot, one colour per state. Green is stated rather than
            // implied: a tab that says nothing looks the same as a tab whose
            // indicator is broken.
            const status = tabStatus(buf);
            const dotTitle = {
              error: buf?.error ?? "Something went wrong",
              conflict: "Changed on disk while you were editing",
              unseen: "Reloaded from disk — changed lines are marked",
              dirty: "Unsaved changes",
              saved: "Saved",
            }[status];
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
                  e.dataTransfer.setData(
                    TAB_MIME,
                    JSON.stringify({ from: group.id, name })
                  );
                  cb.onTabDragStart();
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(TAB_MIME)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={(e) => {
                  const raw = e.dataTransfer.getData(TAB_MIME);
                  if (!raw) return;
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    cb.onDropTab(JSON.parse(raw), i);
                  } catch {
                    /* ignore malformed */
                  }
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                  cb.onTabDragEnd();
                }}
                title={`${name}  —  double-click to rename`}
              >
                {/* Status sits left of the name and the close button right of
                    it: one side says what the note is, the other acts on it,
                    and a glance never has to tell them apart. */}
                <span className={`tab-dot ${status}`} title={dotTitle} />
                <span className="tab-name">{name}</span>
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    cb.onCloseTab(name);
                  }}
                  title="Close (Cmd+W)"
                >
                  <X size={12} strokeWidth={2} />
                </span>
              </button>
            );
          })}
          <button
            className="tab-new"
            onClick={cb.onNewTab}
            title="New note (Cmd+T)"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="group-actions">
          {/* Single preview control: click toggles in place, ⌥-click (or the
              button while ⌥ is held) opens the preview side by side. */}
          {isMd && (
            <button
              className={"group-btn" + (showPreview && !altHeld ? " on" : "")}
              onClick={(e) =>
                e.altKey ? cb.onPreviewToSide() : cb.onToggleMode()
              }
              title={
                altHeld
                  ? "Preview to the side (Cmd+Shift+V)"
                  : "Markdown preview — hold ⌥ for side by side"
              }
              aria-label="Preview"
            >
              {altHeld ? (
                <Columns2 size={15} strokeWidth={1.8} />
              ) : (
                <Eye size={15} strokeWidth={1.8} />
              )}
            </button>
          )}
          {/* Split — click splits right, ⌥ splits down (icon morphs). */}
          <button
            className="group-btn"
            onClick={(e) => cb.onSplit(e.altKey ? "col" : "row")}
            title={
              altHeld
                ? "Split down (Cmd+Shift+\\)"
                : "Split right (Cmd+\\) — ⌥ for down"
            }
            aria-label={altHeld ? "Split down" : "Split right"}
          >
            {altHeld ? (
              <SquareSplitVertical size={15} strokeWidth={1.8} />
            ) : (
              <SquareSplitHorizontal size={15} strokeWidth={1.8} />
            )}
          </button>
          {/* Close — click closes the pane, ⌥ merges it into a neighbour. */}
          {canClose && (
            <button
              className="group-btn"
              onClick={(e) => (e.altKey ? cb.onMerge() : cb.onCloseGroup())}
              title={
                altHeld
                  ? "Merge into the neighbouring pane"
                  : "Close this pane — ⌥ to merge"
              }
              aria-label={altHeld ? "Merge pane" : "Close pane"}
            >
              {altHeld ? (
                <SquaresUnite size={15} strokeWidth={1.8} />
              ) : (
                <X size={15} strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      </div>

      {activeBuf?.conflict && (
        <div className="conflict-bar">
          <TriangleAlert size={13} strokeWidth={2.5} aria-hidden />
          {/* Truncates in a narrow pane, so the whole sentence is on the
              element itself rather than only in the layout. */}
          <span
            className="conflict-msg"
            title="Changed on disk while you were editing"
          >
            Changed on disk while you were editing
          </span>
          <button
            className="conflict-btn"
            onClick={() => cb.onResolveConflict(activeBuf.name, "disk")}
          >
            Use disk version
          </button>
          <button
            className="conflict-btn primary"
            onClick={() => cb.onResolveConflict(activeBuf.name, "mine")}
          >
            Keep mine
          </button>
        </div>
      )}

      <div className="editor-wrap">
        {activeBuf && showPreview ? (
          <MarkdownPreview content={previewContent} />
        ) : activeBuf ? (
          <Editor
            tab={activeBuf.name}
            tabs={group.tabs}
            content={activeBuf.content}
            focused={focused}
            theme={theme}
            gutterOn={gutterOn}
            wrapOn={wrapOn}
            langExt={langExt}
            changed={activeBuf.changed}
            onChange={cb.onChange}
          />
        ) : (
          <div className="empty-pane">
            <div className="empty-pane-inner">
              <div className="empty-title">Empty pane</div>
              <button className="empty-btn" onClick={cb.onNewTab}>
                New note
              </button>
              <div className="empty-hint">
                ⌘T new · ⌘O open · or drop a tab here
              </div>
            </div>
          </div>
        )}
        {/* While a tab is being dragged, a full-body catcher sits above the
            editor so the tab can be dropped anywhere on the pane. */}
        {dragging && (
          <div
            className={"drop-catcher" + (dropActive ? " active" : "")}
            // Last resort: if a catcher ever outlives its drag, clicking the
            // editor dismisses it instead of leaving the pane unresponsive.
            onMouseDown={cb.onTabDragEnd}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TAB_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!dropActive) setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(TAB_MIME);
              setDropActive(false);
              if (!raw) return;
              e.preventDefault();
              try {
                cb.onDropTab(JSON.parse(raw), group.tabs.length);
              } catch {
                /* ignore malformed */
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
