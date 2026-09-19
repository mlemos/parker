// The preview's map back to the source: every block carries the 1-based line
// it starts on, as `data-line`. markdown-it already knows — each block token
// has `map = [start, end]` — it just never wrote it down. This is what lets
// the side-by-side preview follow the cursor, show the selection, and paint
// the same lines amber that the editor does. The HTML is otherwise untouched.

import type { MarkdownIt, Token } from "markdown-it";

export const LINE_ATTR = "data-line";

/** The plugin: a core rule after the block parse. Opening tokens and the
 *  self-contained blocks (fence, code, hr, html) get the attribute; closing
 *  and inline tokens do not. */
export function lineMapPlugin(md: MarkdownIt): void {
  md.core.ruler.push("parker_line_map", (state) => {
    for (const t of state.tokens) mark(t);
  });
}

function mark(t: Token): void {
  if (!t.map || t.nesting === -1 || t.type === "inline") return;
  // Anything block-level that starts a line: `*_open`, plus the blocks that
  // open and close in one token.
  if (t.nesting === 1 || t.block) t.attrSet(LINE_ATTR, String(t.map[0] + 1));
}

// ---- Reading the map back, on the preview side ------------------------------
// Pure over a list of start lines in document order, so it is testable
// without a DOM: the component reads the numbers off the elements and asks.

/** Index of the block the cursor is in: the last one (in document order)
 *  that starts at or before the line — which is the innermost, since a
 *  container starts on the same line as its first child and comes first.
 *  -1 when the line is above every block. */
export function blockAt(starts: number[], line: number): number {
  let found = -1;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= line) found = i;
  return found;
}

/** The lines block i covers: from its start to the next block's start. A
 *  container's range is empty when its first child starts on the same line,
 *  so marks land on the innermost block and not on the whole list. */
export function blockRange(starts: number[], i: number): [number, number] {
  const from = starts[i];
  const to = i + 1 < starts.length ? starts[i + 1] : Infinity;
  return [from, to];
}

/** Which blocks contain at least one of the lines. */
export function blocksWithLines(starts: number[], lines: number[]): number[] {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < starts.length; i++) {
    const [from, to] = blockRange(starts, i);
    if (sorted.some((l) => l >= from && l < to)) out.push(i);
  }
  return out;
}

/** Which blocks a selection from line `a` to line `b` touches: the block the
 *  selection starts in, through the block it ends in. */
export function blocksBetween(starts: number[], a: number, b: number): number[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const first = blockAt(starts, from);
  const last = blockAt(starts, to);
  if (last < 0) return [];
  const out: number[] = [];
  for (let i = Math.max(first, 0); i <= last; i++) {
    const [s, e] = blockRange(starts, i);
    // Skip a container whose range is empty (its child carries the mark)
    // and any block that lies wholly outside the selection.
    if (s >= e) continue;
    if (e <= from || s > to) continue;
    out.push(i);
  }
  return out;
}
