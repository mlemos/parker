import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import { EditorView, Prec } from "@uiw/react-codemirror";
import { languageForName } from "../lib/lang";
import { todoHighlighter } from "../lib/todo";
import type { ThemeDef } from "../lib/themes";
import type { Buffer, Group } from "../lib/layout";
import { isMarkdown } from "../lib/markdown";
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="1.5" />
                  <line x1="13" y1="4" x2="13" y2="20" />
                  <path d="M16 10l2 2-2 2" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="1.5" />
              {altHeld ? (
                <line x1="3" y1="12" x2="21" y2="12" />
              ) : (
                <line x1="12" y1="4" x2="12" y2="20" />
              )}
            </svg>
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
                // Two arrows collapsing toward the centre = merge.
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12h8M8 9l3 3-3 3" />
                  <path d="M21 12h-8M16 9l-3 3 3 3" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="editor-wrap">
        {activeBuf && showPreview ? (
          <MarkdownPreview content={activeBuf.content} />
        ) : activeBuf ? (
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
