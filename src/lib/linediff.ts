// Which lines changed, so a note that was rewritten under you can say where.
//
// Not a real diff: no LCS, no move detection, no memory that grows with the
// square of the file. It trims the lines both versions share at the top and at
// the bottom, and calls what is left the change. For what actually happens to a
// note — someone edited a paragraph, a git pull rewrote a section, a line was
// appended — that lands on exactly the right lines, in one pass.
//
// Where it is deliberately coarse: two separate edits far apart in the file
// mark everything between them. The alternative is a real diff, and the cost of
// being wrong here is a few extra lines highlighted in a note you are about to
// read anyway.

/**
 * Lines of `after` (1-based) that differ from `before`.
 *
 * A pure deletion leaves nothing to highlight — the lines are gone — so the
 * junction line is marked instead, which is where the text now reads
 * differently. Identical inputs mark nothing.
 */
export function changedLines(before: string, after: string): number[] {
  if (before === after) return [];

  const a = before.split("\n");
  const b = after.split("\n");

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;

  // The changed span in `after`, as 1-based line numbers.
  const from = head + 1;
  const to = b.length - tail;

  if (to < from) {
    // Nothing survives in `after` — lines were only removed. Mark where they
    // were, clamped to a line that exists.
    const at = Math.min(Math.max(from - 1, 1), b.length);
    return [at];
  }

  const lines: number[] = [];
  for (let n = from; n <= to; n++) lines.push(n);
  return lines;
}
