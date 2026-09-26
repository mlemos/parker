import { useDeferredValue, useEffect, useRef, useState } from "react";
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
  Pin,
  PictureInPicture2,
  ArrowLeftToLine,
  Cloud,
  Link2,
} from "lucide-react";
import { languageForName } from "../lib/lang";
import { tabStatus } from "../lib/workspace";
import { displayName, isExternal } from "../lib/external";
import { PathLabel } from "./PathLabel";
import type { ThemeDef } from "../lib/themes";
import type { Buffer, Group } from "../lib/layout";
import { isPreviewTab, noteOf } from "../lib/layout";
import { isMarkdown } from "../lib/markdown";
import { tabScrollTarget } from "../lib/tab-scroll";
import { Editor } from "./Editor";
import { RenameInput } from "./RenameInput";
import { MarkdownPreview } from "./MarkdownPreview";
import type { TextWidth } from "../lib/text-width";
import type { NoteWindowControls } from "./LayoutView";
import type { ImageMode } from "../lib/images";

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
  onSaveGone: (name: string) => void;
  onRetryCloud: (name: string) => void;
  onReveal: (name: string) => void;
  onPopOut: () => void;
  onDragOut: (id: string) => void;
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
  images = "local",
  notesDir = "",
  links = {},
  renamingName,
  homeDir,
  noteWindow,
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
  images?: ImageMode; // Settings › Privacy & Security › Images in preview
  notesDir?: string; // where a note's local images resolve
  links?: Record<string, string>; // open notes that are symlinks → their file
  renamingName: string | null;
  homeDir: string; // for showing an outside file's path as ~/…
  /** Set when this is the one pane of a note window: no new tab, no split,
   *  no drag — and the pane's buttons are the window's. */
  noteWindow?: NoteWindowControls;
  cb: GroupCallbacks;
}) {
  // In a note window a tab stays where it is: there is nowhere in the window
  // to drag it to, and a drop from another window is not a thing yet.
  const single = !!noteWindow;
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

  // The tab in front is always one you can see: the strip scrolls sideways
  // with no scrollbar, so a tab chosen from the keyboard, the picker or the
  // Finder could otherwise be in front and out of sight. The first showing
  // (launch, a new pane) and a resize jump; a change of tab after that glides.
  const stripRef = useRef<HTMLDivElement>(null);
  const stripShown = useRef(false);
  const revealActive = (smooth: boolean) => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>(".tab.active");
    if (!strip || !tab) return;
    const s = strip.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const left = tabScrollTarget(
      strip.scrollLeft,
      strip.clientWidth,
      t.left - s.left + strip.scrollLeft,
      t.width
    );
    if (left === null) return;
    // A glide runs on animation frames, and a window out of sight gets none:
    // it would never start. There, and for reduced motion, it jumps.
    const glide =
      smooth &&
      document.visibilityState === "visible" &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({ left, behavior: glide ? "smooth" : "auto" });
  };
  const revealRef = useRef(revealActive);
  revealRef.current = revealActive;
  useEffect(() => {
    revealActive(stripShown.current);
    stripShown.current = true;
  }, [active, group.unselected, group.tabs.length, renamingName]);
  // A narrower pane (a split, a resized window) can push the tab out too.
  // Only a change of width counts: the observer also reports on its first
  // look, and a jump then would cut short the glide above.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") return;
    let width = strip.clientWidth;
    const ro = new ResizeObserver(() => {
      if (strip.clientWidth === width) return;
      width = strip.clientWidth;
      revealRef.current(false);
    });
    ro.observe(strip);
    return () => ro.disconnect();
  }, []);

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
          ref={stripRef}
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
                  hint={links[name] ? `Renames the link. ${links[name]} keeps its own name.` : undefined}
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
                draggable={!single}
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
                onDragEnd={(e) => {
                  setDragIndex(null);
                  setOverIndex(null);
                  cb.onTabDragEnd();
                  // Let go of outside the window: nothing in here took the
                  // drop. Whether the pointer ended beyond the window is
                  // asked of the native side — the note gets a window of
                  // its own, there.
                  if (!single && e.dataTransfer.dropEffect === "none") {
                    cb.onDragOut(id);
                  }
                }}
                title={
                  preview
                    ? `Preview of ${name}`
                    : isExternal(name)
                      ? `${name}  —  outside your notes folder`
                      : links[name]
                        ? `${name}  —  a link to ${links[name]}`
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
                {buf?.cloud && (
                  <Cloud className="tab-cloud" size={12} strokeWidth={2} aria-label="In iCloud, not on this Mac yet" />
                )}
                <span className="tab-name">{displayName(name)}</span>
                {/* A symlinked note: edits go to the file it points at. */}
                {links[name] && !preview && (
                  <Link2 className="tab-link" size={11} strokeWidth={2} aria-label="A link" />
                )}
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    cb.onCloseTab(id);
                  }}
                  title={single ? "Close window (Cmd+W)" : "Close (Cmd+W)"}
                >
                  <X size={12} strokeWidth={2} />
                </span>
              </button>
            );
          })}
          {!single && (
            <button
              className="tab-new"
              onClick={cb.onNewTab}
              title="New note (Cmd+T)"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          )}
        </div>
        {single ? (
          /* The pane is the window: its buttons are the window's — preview in
             place, pin above the other windows, and the way back to the main
             window. */
          <div className="group-actions">
            {isMd && (
              <button
                className={"group-btn" + (showPreview ? " on" : "")}
                onClick={cb.onToggleMode}
                title="Markdown preview"
                aria-label="Preview"
                aria-pressed={showPreview}
              >
                <Eye size={15} strokeWidth={1.8} />
              </button>
            )}
            <button
              className={"group-btn" + (noteWindow!.onTop ? " on" : "")}
              onClick={noteWindow!.onToggleTop}
              title={
                noteWindow!.onTop
                  ? "Pinned above other windows — click to unpin"
                  : "Keep on top of other windows"
              }
              aria-label="Keep on top"
              aria-pressed={noteWindow!.onTop}
            >
              <Pin size={15} strokeWidth={1.8} />
            </button>
            <button
              className="group-btn"
              onClick={noteWindow!.onDockBack}
              title="Move back to the main window"
              aria-label="Move back to the main window"
            >
              <ArrowLeftToLine size={15} strokeWidth={1.8} />
            </button>
          </div>
        ) : (
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
          {/* The note in front moves to a window of its own. */}
          {activeBuf && (
            <button
              className="group-btn"
              onClick={cb.onPopOut}
              title="Open in new window (Cmd+Shift+N)"
              aria-label="Open in new window"
            >
              <PictureInPicture2 size={15} strokeWidth={1.8} />
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
        )}
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

      {activeBuf?.gone && !activeBuf.conflict && (
        <div className="conflict-bar" role="status">
          <TriangleAlert size={13} strokeWidth={2.5} aria-hidden />
          <span
            className="conflict-msg"
            title="This note was deleted or moved outside Parker"
          >
            This note was deleted or moved outside Parker
          </span>
          <button className="conflict-btn" onClick={() => cb.onCloseTab(activeBuf.name)}>
            Close tab
          </button>
          <button className="conflict-btn primary" onClick={() => cb.onSaveGone(activeBuf.name)}>
            Save it again
          </button>
        </div>
      )}

      <div className="editor-wrap">
        {activeBuf?.cloud ? (
          <div className="empty-pane cloud-pane" role="status">
            <div className="empty-pane-inner">
              <Cloud size={22} strokeWidth={1.6} aria-hidden />
              {activeBuf.cloud === "downloading" ? (
                <div className="empty-title">Downloading from iCloud…</div>
              ) : (
                <>
                  <div className="empty-title">This note is in iCloud and isn't on this Mac yet</div>
                  <div className="cloud-sub">It opens by itself when iCloud delivers it. If this Mac is offline, connect and try again.</div>
                  <button className="empty-btn" onClick={() => cb.onRetryCloud(activeBuf.name)}>
                    Try again
                  </button>
                </>
              )}
            </div>
          </div>
        ) : activeBuf && showPreview ? (
          <MarkdownPreview
            content={previewContent}
            name={activeBuf.name}
            changed={activeBuf.changed}
            sync={previewSync}
            images={images}
            notesDir={notesDir}
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
