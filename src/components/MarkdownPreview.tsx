import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "../lib/markdown";
import { LINE_ATTR, blockAt, blocksBetween, blocksWithLines } from "../lib/line-map";
import { cursorOf, onCursor, onViewport, viewportOf } from "../lib/preview-sync";
import type { CursorPos, Viewport } from "../lib/preview-sync";

// Read-only rendered view of a markdown buffer. Content is shared state, so it
// re-renders live as the note is edited in another pane.
//
// With `sync` on it also follows that pane: it scrolls with the editor, the
// block the cursor is in is lit the way the current line is, a selection
// covers the blocks it runs through, and the lines a reload painted amber are
// amber here too. All of it is done to the DOM directly — the blocks carry
// their source line (lib/line-map), the editor posts where it is
// (lib/preview-sync), and nothing here re-renders for a cursor move.
export function MarkdownPreview({
  content,
  name,
  changed,
  sync,
}: {
  content: string;
  /** The note shown, for listening to the right editor. */
  name: string;
  /** Lines (1-based) a reload from disk rewrote. */
  changed?: number[];
  /** Follow the editor. */
  sync: boolean;
}) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  /** The mapped blocks, read off the DOM as it is right now. Not cached: the
   *  DOM under `body` is React's to replace, and a list taken at one commit
   *  was found holding detached elements by the next. Seventy-odd elements
   *  once a frame is nothing. */
  const read = () => {
    const els = body.current
      ? Array.from(body.current.querySelectorAll<HTMLElement>(`[${LINE_ATTR}]`))
      : [];
    return { els, starts: els.map((el) => Number(el.getAttribute(LINE_ATTR))) };
  };

  const setClass = (els: HTMLElement[], cls: string, on: number[]) => {
    const want = new Set(on);
    els.forEach((el, i) => el.classList.toggle(cls, want.has(i)));
  };

  const applyChanged = () => {
    const { els, starts } = read();
    setClass(els, "md-changed", blocksWithLines(starts, changed ?? []));
  };

  const applyCursor = (pos: CursorPos) => {
    const { els, starts } = read();
    const at = blockAt(starts, pos.line);
    setClass(els, "md-cursor", at >= 0 ? [at] : []);
    setClass(els, "md-selected", pos.from !== pos.to ? blocksBetween(starts, pos.from, pos.to) : []);
    // Keep the cursor's block in view, but only when it isn't: the scroll
    // itself follows the editor's viewport, below, and this must not fight it.
    const el = els[at];
    const r = root.current;
    if (!el || !r) return;
    const a = el.getBoundingClientRect();
    const b = r.getBoundingClientRect();
    // The container itself, not scrollIntoView: that walks every scrollable
    // ancestor, and the pane around us is not to move.
    if (a.bottom > b.bottom) r.scrollTop += Math.min(a.bottom - b.bottom, a.top - b.top);
    else if (a.top < b.top) r.scrollTop -= b.top - a.top;
  };

  const applyViewport = (vp: Viewport) => {
    const { els, starts } = read();
    const r = root.current;
    const el = els[blockAt(starts, vp.top)];
    if (!el || !r) return;
    // The editor's first visible line at the top of the preview.
    r.scrollTop += el.getBoundingClientRect().top - r.getBoundingClientRect().top;
  };

  // A fresh render is a fresh DOM: put every mark on again, before paint.
  useLayoutEffect(() => {
    applyChanged();
    if (sync) {
      const vp = viewportOf(name);
      if (vp) applyViewport(vp);
      const pos = cursorOf(name);
      if (pos) applyCursor(pos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  useEffect(() => {
    applyChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed]);

  useEffect(() => {
    if (!sync) {
      const { els } = read();
      setClass(els, "md-cursor", []);
      setClass(els, "md-selected", []);
      return;
    }
    const vp = viewportOf(name);
    if (vp) applyViewport(vp);
    const pos = cursorOf(name);
    if (pos) applyCursor(pos);
    const offV = onViewport(name, applyViewport);
    const offC = onCursor(name, applyCursor);
    return () => {
      offV();
      offC();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, name]);

  return (
    <div className={"md-preview" + (sync ? " synced" : "")} ref={root}>
      <div
        ref={body}
        className="md-body"
        // Safe: markdown-it runs with html:false and validates link schemes.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
