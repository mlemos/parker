import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { NoteHit } from "../lib/api";

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

// Command-palette overlay: search every note by filename AND content, with a
// snippet for content matches, type-to-filter and full keyboard navigation.
export function NotePicker({
  openNames,
  onOpen,
  onDeleted,
  onClose,
}: {
  openNames: string[];
  onOpen: (name: string) => void;
  onDeleted: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteHit[]>([]);
  const [sel, setSel] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced backend search (matches name + content). Guard against races.
  useEffect(() => {
    const id = ++reqId.current;
    const t = setTimeout(
      () => {
        api
          .searchNotes(query)
          .then((hits) => {
            if (reqId.current === id) {
              setResults(hits);
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

  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i: number) => {
    const n = results[i];
    if (n) onOpen(n.name);
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
    setSel((s) => Math.max(0, Math.min(s, results.length - 2)));
    onDeleted(name);
    inputRef.current?.focus();
  };

  return (
    <div className="picker-overlay" onMouseDown={onClose}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="Search notes…  name or text"
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
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(sel);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (
              e.metaKey &&
              (e.key === "Backspace" || e.key === "Delete")
            ) {
              e.preventDefault();
              const n = results[sel];
              if (n) setConfirming(n.name);
            }
          }}
        />
        <div className="picker-list">
          {results.length === 0 && <div className="picker-empty">No matches</div>}
          {results.map((n, i) => (
            <div
              key={n.name}
              ref={i === sel ? selRef : undefined}
              className={
                "picker-item" +
                (i === sel ? " sel" : "") +
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
                  <Highlight text={n.name} query={query} />
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
          ))}
        </div>
        <div className="picker-hint">
          ↑↓ navigate · ↵ open · ⌘⌫ delete · esc close
        </div>
      </div>
    </div>
  );
}
