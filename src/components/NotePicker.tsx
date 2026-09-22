import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CornerLeftUp, Folder, FolderOpen, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { NoteHit } from "../lib/api";
import { fmtSize } from "../lib/size";
import { displayName, folderOf } from "../lib/external";
import {
  childFolders,
  folderName,
  matchingFolders,
  parentScope,
  scopeTyped,
} from "../lib/picker";
import type { FolderRow } from "../lib/picker";

function relTime(secs: number): string {
  if (!secs) return "";
  const d = Date.now() / 1000 - secs;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// Highlight the first case-insensitive occurrence of `query` in `text`.
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const idx = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="picker-mark">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

type Row = { kind: "up" } | { kind: "folder"; f: FolderRow } | { kind: "note"; n: NoteHit };

// Command-palette overlay: search every note by filename AND content, with a
// snippet for content matches, type-to-filter and full keyboard navigation.
//
// Folders are part of it. At the root the folders come first, then the
// recent notes from everywhere; a search lists the folders whose name
// matches above the notes. → or ↵ on a folder (or typing "desks/") steps
// into it: the folder becomes a chip before the field, the list shows what
// is inside without the prefix, and the search stays inside. ⌫ on an empty
// field, or ←, steps back out. ⌘N makes a note where you are.
export function NotePicker({
  openNames,
  onOpen,
  onNewNote,
  onDeleted,
  onClose,
}: {
  openNames: string[];
  onOpen: (name: string) => void;
  /** A new note in this folder ("" for the root). */
  onNewNote?: (folder: string) => void;
  onDeleted: (name: string) => void;
  onClose: () => void;
}) {
  // Where we are: "" at the root, "cos/desks/" inside a folder.
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteHit[]>([]);
  // Every note, for the folder rows' counts and dates; every folder, the
  // empty ones included, from the folder walk.
  const [all, setAll] = useState<NoteHit[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    api.listFolders?.().then(setFolders).catch(() => {});
  }, []);

  // Debounced backend search (matches name + content). Guard against races.
  // An empty search is also the census the folder rows are built from.
  useEffect(() => {
    const id = ++reqId.current;
    const t = setTimeout(
      () => {
        api
          .searchNotes(query)
          .then((hits) => {
            if (reqId.current === id) {
              setResults(hits);
              if (!query.trim()) setAll(hits);
              setSel(0);
              setConfirming(null);
            }
          })
          .catch(() => {});
      },
      query ? 110 : 0
    );
    return () => clearTimeout(t);
  }, [query]);

  // Typing a folder's name and a slash walks into it.
  useEffect(() => {
    const next = scopeTyped(query, scope, folders, all);
    if (next !== null) {
      setScope(next);
      setQuery("");
    }
  }, [query, scope, folders, all]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim();
    const inScope = results.filter((n) => n.name.startsWith(scope));
    if (!q) {
      const up: Row[] = scope ? [{ kind: "up" }] : [];
      const dirs = childFolders(folders, all, scope).map((f): Row => ({ kind: "folder", f }));
      // At the root the notes come from everywhere, most recent first — the
      // folders above are the way in when you know where you are going.
      // Inside a folder, only its own notes: the subfolders stand for theirs.
      const notes = (scope ? inScope.filter((n) => !n.name.slice(scope.length).includes("/")) : inScope)
        .map((n): Row => ({ kind: "note", n }));
      return [...up, ...dirs, ...notes];
    }
    const dirs = matchingFolders(folders, all, scope, q).map((f): Row => ({ kind: "folder", f }));
    return [...dirs, ...inScope.map((n): Row => ({ kind: "note", n }))];
  }, [results, folders, all, scope, query]);

  useEffect(() => {
    setSel(0);
  }, [scope]);

  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const enter = (path: string) => {
    setScope(path);
    setQuery("");
    setConfirming(null);
    inputRef.current?.focus();
  };
  const up = () => enter(parentScope(scope));

  const choose = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "up") up();
    else if (row.kind === "folder") enter(row.f.path);
    else onOpen(row.n.name);
  };

  const doDelete = async (name: string) => {
    setConfirming(null);
    try {
      await api.deleteNote(name);
    } catch (e) {
      console.error("delete failed", name, e);
      return;
    }
    setResults((r) => r.filter((x) => x.name !== name));
    setAll((r) => r.filter((x) => x.name !== name));
    setSel((s) => Math.max(0, Math.min(s, rows.length - 2)));
    onDeleted(name);
    inputRef.current?.focus();
  };

  const crumbs = scope ? scope.slice(0, -1).split("/") : [];
  const here = scope ? folderName(scope) : "";
  const count = all.filter((n) => n.name.startsWith(scope)).length;

  return (
    <div className="picker-overlay" onMouseDown={onClose}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-field">
          {crumbs.length > 0 && (
            <div className="picker-crumbs" aria-label="Folder">
              <button
                className="picker-crumb root"
                title="All notes"
                aria-label="All notes"
                onMouseDown={(e) => {
                  e.preventDefault();
                  enter("");
                }}
              >
                <Folder size={12} strokeWidth={2} aria-hidden />
              </button>
              {crumbs.map((c, i) => (
                <button
                  key={i}
                  className="picker-crumb"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    enter(crumbs.slice(0, i + 1).join("/") + "/");
                  }}
                >
                  <ChevronRight size={11} strokeWidth={2} className="picker-crumb-sep" aria-hidden />
                  {c}
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            className="picker-input"
            placeholder={scope ? `Search in ${here}…` : "Search notes…  name or text"}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (confirming) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  doDelete(confirming);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setConfirming(null);
                }
                return;
              }
              const row = rows[sel];
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "ArrowRight" && row?.kind === "folder") {
                e.preventDefault();
                enter(row.f.path);
              } else if (e.key === "ArrowLeft" && !query && scope) {
                e.preventDefault();
                up();
              } else if (e.key === "Backspace" && !query && scope) {
                e.preventDefault();
                up();
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(sel);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.metaKey && e.key.toLowerCase() === "n" && onNewNote) {
                e.preventDefault();
                onNewNote(scope.replace(/\/$/, ""));
              } else if (
                e.metaKey &&
                (e.key === "Backspace" || e.key === "Delete")
              ) {
                e.preventDefault();
                if (row?.kind === "note") setConfirming(row.n.name);
              }
            }}
          />
        </div>
        <div className="picker-list">
          {rows.length === 0 && <div className="picker-empty">No matches</div>}
          {rows.map((row, i) => {
            const isSel = i === sel;
            if (row.kind === "up") {
              const parent = parentScope(scope);
              return (
                <div
                  key=".."
                  ref={isSel ? selRef : undefined}
                  className={"picker-item picker-folder up" + (isSel ? " sel" : "")}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    up();
                  }}
                >
                  <CornerLeftUp size={14} strokeWidth={1.8} className="picker-folder-icon" aria-hidden />
                  <span className="picker-name">..</span>
                  <span className="picker-time">{parent ? folderName(parent) : "All notes"}</span>
                </div>
              );
            }
            if (row.kind === "folder") {
              const f = row.f;
              // Inside a search, a folder deeper down shows its own folder
              // first, quietly — cos/desks/ is not desks/.
              const rel = f.path.slice(scope.length);
              const parentRel = folderOf(rel.slice(0, -1));
              return (
                <div
                  key={f.path}
                  ref={isSel ? selRef : undefined}
                  className={"picker-item picker-folder" + (isSel ? " sel" : "")}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    enter(f.path);
                  }}
                >
                  {isSel ? (
                    <FolderOpen size={14} strokeWidth={1.8} className="picker-folder-icon" aria-hidden />
                  ) : (
                    <Folder size={14} strokeWidth={1.8} className="picker-folder-icon" aria-hidden />
                  )}
                  <span className="picker-name">
                    {parentRel && <span className="picker-dir">{parentRel}</span>}
                    <Highlight text={folderName(f.path)} query={query} />
                    <span className="picker-dir">/</span>
                  </span>
                  <span className="picker-size">
                    {f.count === 0 ? "empty" : `${f.count} ${f.count === 1 ? "note" : "notes"}`}
                  </span>
                  <span className="picker-time">{relTime(f.modified)}</span>
                  <ChevronRight size={14} strokeWidth={1.8} className="picker-folder-go" aria-hidden />
                </div>
              );
            }
            const n = row.n;
            const rel = n.name.slice(scope.length);
            return (
              <div
                key={n.name}
                ref={isSel ? selRef : undefined}
                className={
                  "picker-item" +
                  (isSel ? " sel" : "") +
                  (confirming === n.name ? " confirming" : "")
                }
                onMouseEnter={() => setSel(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (confirming !== n.name) onOpen(n.name);
                }}
              >
                <div className="picker-main">
                  <span className="picker-name">
                    {/* The folder, quietly, before the name — the part below
                        where we are. It is part of what you typed to find
                        it, so it is highlighted too. */}
                    {folderOf(rel) && (
                      <span className="picker-dir">
                        <Highlight text={folderOf(rel)} query={query} />
                      </span>
                    )}
                    <Highlight text={displayName(rel)} query={query} />
                  </span>
                  {n.snippet && (
                    <span className="picker-snippet">
                      <Highlight text={n.snippet} query={query} />
                    </span>
                  )}
                </div>

                {confirming === n.name ? (
                  <div className="picker-confirm">
                    <span className="picker-confirm-label">Move to Trash?</span>
                    <button
                      className="picker-del-yes"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        doDelete(n.name);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="picker-del-no"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirming(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    {openNames.includes(n.name) && (
                      <span className="picker-open">open</span>
                    )}
                    {/* A badge like "open", quiet — except an empty note, which
                        is the one worth noticing in a list: it gets a colour,
                        so a stray Untitled is caught here rather than opened
                        to find out. */}
                    <span className={"picker-size" + (n.size === 0 ? " empty" : "")}>
                      {fmtSize(n.size)}
                    </span>
                    <span className="picker-time">{relTime(n.modified)}</span>
                    <button
                      className="picker-trash"
                      title="Move to Trash (⌘⌫)"
                      aria-label="Move to Trash"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSel(i);
                        setConfirming(n.name);
                      }}
                    >
                      <Trash2 size={14} strokeWidth={1.8} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="picker-hint">
          <span>
            ↑↓ navigate · ↵ open · → into folder · ⌫ up · ⌘N new note{scope ? " here" : ""} · ⌘⌫
            delete · esc close
          </span>
          {all.length > 0 && (
            <span className="picker-hint-count">
              {count} {count === 1 ? "note" : "notes"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
