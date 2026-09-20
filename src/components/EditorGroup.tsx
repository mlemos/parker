import { useDeferredValue, useEffect, useState } from "react";
import type { Extension } from "@uiw/react-codemirror";
import {
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquaresUnite,
  TriangleAlert,
  FolderOutput,
  Eye,
  Columns2,
  X,
  Plus,
} from "lucide-react";
import { languageForName } from "../lib/lang";
import { tabStatus } from "../lib/workspace";
import { displayName, isExternal } from "../lib/external";
import { PathLabel } from "./PathLabel";
import type { ThemeDef } from "../lib/themes";
import type { Buffer, Group } from "../lib/layout";
import { isPreviewTab, noteOf } from "../lib/layout";
import { isMarkdown } from "../lib/markdown";
import { Editor } from "./Editor";
import { RenameInput } from "./RenameInput";
import { MarkdownPreview } from "./MarkdownPreview";
import type { TextWidth } from "../lib/text-width";

const TAB_MIME = "application/x-parker-tab";

export interface GroupCallbacks {
  onFocus: () => void;
  onSelectTab: (name: string) => void;
  onDeselectTab: () => void;
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
  onFileDragOver: (index?: number) => void;
  onCloseGroup: () => void;
  onResolveConflict: (name: string, take: "disk" | "mine") => void;
  onReveal: (name: string) => void;
}

export function EditorGroup({
  group,
  buffers,
  focused,
  canClose,
  altHeld,
  dragging,
  fileDragging,
  theme,
  gutterOn,
  wrapOn,
  width,
  previewSync,
  renamingName,
  homeDir,
  cb,
}: {
  group: Group;
  buffers: Buffer[];
  focused: boolean;
  canClose: boolean; // more than one group exists
  altHeld: boolean; // Option held → each action button shows its alternate
  dragging: boolean; // a tab is being dragged somewhere in the app
  fileDragging: boolean; // a file from the Finder is over the window
  theme: ThemeDef;
  gutterOn: boolean;
  wrapOn: boolean;
  width: TextWidth;
  previewSync: boolean; // the preview follows the editor
  renamingName: string | null;
  homeDir: string; // for showing an outside file's path as ~/…
  cb: GroupCallbacks;
}) {
  const [langExt, setLangExt] = useState<Extension[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false); // a tab is over the body

  const active = group.active;
  // The tab in front is an editor or a preview of a note; the note is what
  // the buffer, the language and the band are about.
  const activeNote = active ? noteOf(active) : null;
  const activeBuf = buffers.find((b) => b.name === activeNote) ?? null;
  const isMd = isMarkdown(activeNote);
  // A file from outside the notes folder — edited where it is, and said so.
  const outside = !!activeBuf && isExternal(activeBuf.name);
  const showPreview = isPreviewTab(active) && !!activeBuf;
  // Deferred so a side-by-side preview re-renders at low priority instead of
  // running markdown-it over the whole document inside every keystroke.
  const previewContent = useDeferredValue(activeBuf?.content ?? "");

  useEffect(() => {
    if (!activeNote) return;
    let alive = true;
    languageForName(activeNote).then((ext) => {
      if (alive) setLangExt(ext);
    });
    return () => {
      alive = false;
    };
  }, [activeNote]);

  // A drag that began in another group never reaches this group's tab
  // onDragEnd, so the hover state it left here is cleared when the app-wide
  // drag ends instead — otherwise a stale insertion bar would stay behind.
  useEffect(() => {
    if (!dragging) {
      setOverIndex(null);
      setDragIndex(null);
    }
  }, [dragging]);
  // The file drop is taken natively, so no dragleave follows it: the ring
  // goes when the app-wide flag does.
  useEffect(() => {
    if (!fileDragging) {
      setDropActive(false);
      setOverIndex(null);
    }
  }, [fileDragging]);

  return (
    <div
      className={"egroup" + (focused ? " focused" : "")}
      onMouseDown={cb.onFocus}
      // A file crossing this pane, wherever over it: this is where it opens
      // if it is let go of here. The drop itself never reaches the DOM.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) cb.onFileDragOver();
      }}
    >
      <div className="tabstrip">
        <div
          className={
            "tabs" +
            ((dragging || fileDragging) && overIndex === group.tabs.length
              ? " drop-end"
              : "") +
            (fileDragging ? " file" : "")
          }
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(TAB_MIME)) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              // Over the strip itself or the + button, past the last tab: the
              // tab would be appended, so the insertion bar goes after it.
              if (
                !(e.target as HTMLElement).closest(".tab") &&
                overIndex !== group.tabs.length
              )
                setOverIndex(group.tabs.length);
            } else if (e.dataTransfer.types.includes("Files")) {
              // Over the strip past the tabs, a file goes on the end — the
              // bar says so. The pane root, above, hears this too and records
              // the pane.
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (overIndex !== group.tabs.length) setOverIndex(group.tabs.length);
            }
          }}
          onDragLeave={(e) => {
            // Leaving the strip altogether, not just moving between its tabs.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setOverIndex(null);
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
          // The strip's own empty space: a click there puts no tab in front,
          // which is how a split is asked for empty.
          onClick={(e) => {
            if (e.target === e.currentTarget) cb.onDeselectTab();
          }}
        >
          {group.tabs.map((id, i) => {
            const name = noteOf(id);
            const preview = isPreviewTab(id);
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
            return renamingName === name && focused && !preview ? (
              <div key={id} className="tab active editing">
                <RenameInput
                  initial={displayName(name)}
                  onCommit={(v) => cb.onCommitRename(name, v)}
                  onCancel={cb.onCancelRename}
                />
              </div>
            ) : (
              <button
                key={id}
                className={
                  "tab" +
                  (preview ? " preview" : "") +
                  (id === active && !group.unselected ? " active" : "") +
                  (i === dragIndex ? " dragging" : "") +
                  // App-wide `dragging` rather than this group's dragIndex, so
                  // a tab arriving from another pane also shows where it lands.
                  (i === overIndex && (dragging || fileDragging) && dragIndex !== i
                    ? " drag-over"
                    : "")
                }
                draggable
                onClick={() => cb.onSelectTab(id)}
                onDoubleClick={() => cb.onStartRename(name)}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(
                    TAB_MIME,
                    JSON.stringify({ from: group.id, name: id })
                  );
                  cb.onTabDragStart();
                }}
                onDragOver={(e) => {
                  const tab = e.dataTransfer.types.includes(TAB_MIME);
                  if (!tab && !e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = tab ? "move" : "copy";
                  if (overIndex !== i) setOverIndex(i);
                  // A file takes this tab's place, as a dragged tab would.
                  if (!tab) cb.onFileDragOver(i);
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
                title={
                  preview
                    ? `Preview of ${name}`
                    : isExternal(name)
                      ? `${name}  —  outside your notes folder`
                      : `${name}  —  double-click to rename`
                }
              >
                {/* Status sits left of the name and the close button right of
                    it: one side says what the note is, the other acts on it,
                    and a glance never has to tell them apart. A preview tab
                    wears the eye instead of the dot: it has no state of its
                    own — the note's editor carries that. */}
                {preview ? (
                  <Eye className="tab-eye" size={12} strokeWidth={2} aria-hidden />
                ) : (
                  <span className={`tab-dot ${status}`} title={dotTitle} />
                )}
                <span className="tab-name">{displayName(name)}</span>
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    cb.onCloseTab(id);
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

      {outside && (
        <div className="outside-bar">
          {/* The label is the button: it says what this is, and takes you to
              where it lives. The path beside it gives way when the pane is
              narrow; the whole story is on the tooltip. */}
          <button
            className="outside-btn"
            onClick={() => cb.onReveal(activeBuf.name)}
            title="Outside your notes folder — not backed up, not in search. Click to show in Finder."
            aria-label="External file — show in Finder"
          >
            <FolderOutput size={13} strokeWidth={2} aria-hidden />
            External
          </button>
          <PathLabel className="outside-path" path={activeBuf.name} home={homeDir} />
        </div>
      )}

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
          <MarkdownPreview
            content={previewContent}
            name={activeBuf.name}
            changed={activeBuf.changed}
            sync={previewSync}
          />
        ) : activeBuf ? (
          <Editor
            tab={activeBuf.name}
            tabs={group.tabs}
            content={activeBuf.content}
            focused={focused}
            theme={theme}
            gutterOn={gutterOn}
            wrapOn={wrapOn}
            width={width}
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
              {/* There is no tab to drop when no pane has one — then the
                  only thing that can be dropped here is a file. */}
              <div className="empty-hint">
                {buffers.length > 0
                  ? "⌘N new · ⌘O open · or drop a tab or a file here"
                  : "⌘N new · ⌘O open · or drop a file here"}
              </div>
            </div>
          </div>
        )}
        {/* While a tab — or a file from the Finder — is being dragged, a
            full-body catcher sits above the editor so it can be dropped
            anywhere on the pane. For a file it is also what keeps WebKit from
            showing an insertion caret in the editor underneath. */}
        {(dragging || fileDragging) && (
          <div
            className={
              "drop-catcher" +
              (dropActive ? " active" : "") +
              (fileDragging ? " file" : "")
            }
            // Last resort: if a catcher ever outlives its drag, clicking the
            // editor dismisses it instead of leaving the pane unresponsive.
            onMouseDown={cb.onTabDragEnd}
            onDragOver={(e) => {
              const tab = e.dataTransfer.types.includes(TAB_MIME);
              if (!tab && !e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = tab ? "move" : "copy";
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
