import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteMeta } from "../lib/api";

function relTime(secs: number): string {
  if (!secs) return "";
  const d = Date.now() / 1000 - secs;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// A command-palette-style overlay that lists every note in the folder —
// open or closed — with type-to-filter and full keyboard navigation.
export function NotePicker({
  notes,
  openNames,
  onOpen,
  onClose,
}: {
  notes: NoteMeta[];
  openNames: string[];
  onOpen: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? notes.filter((n) => n.name.toLowerCase().includes(q)) : notes;
  }, [notes, query]);

  useEffect(() => {
    setSel(0);
  }, [query]);

  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i: number) => {
    const n = filtered[i];
    if (n) onOpen(n.name);
  };

  return (
    <div className="picker-overlay" onMouseDown={onClose}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="Open note…  type to filter"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(sel);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="picker-list">
          {filtered.length === 0 && <div className="picker-empty">No notes</div>}
          {filtered.map((n, i) => (
            <div
              key={n.name}
              ref={i === sel ? selRef : undefined}
              className={"picker-item" + (i === sel ? " sel" : "")}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onOpen(n.name);
              }}
            >
              <span className="picker-name">{n.name}</span>
              {openNames.includes(n.name) && (
                <span className="picker-open">open</span>
              )}
              <span className="picker-time">{relTime(n.modified)}</span>
            </div>
          ))}
        </div>
        <div className="picker-hint">↑↓ navigate · ↵ open · esc close</div>
      </div>
    </div>
  );
}
