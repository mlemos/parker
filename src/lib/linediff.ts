// Which lines changed, so a note that was rewritten under you can say where.
//
// A line diff: the lines both versions share at the top and bottom are
// trimmed in one pass, and what is left is aligned by longest common
// subsequence, so two edits far apart mark two places, not everything
// between. It used to call the whole span the change, and a to-do checked on
// the phone painted a page amber — which reads as "everything changed" in a
// note where one line did.
//
// The LCS is quadratic in the middle section only, after the trim, and a
// middle too large for that (a whole-file rewrite of a very long note) falls
// back to the span — where marking everything is nearly right anyway.

/** Above this many cells the table is not built and the span is marked. */
const LCS_CELLS = 4_000_000;

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

  // The middle: what is left of each side once the shared ends are gone.
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);

  if (bm.length === 0) {
    // Nothing survives in `after` — lines were only removed. Mark where they
    // were, clamped to a line that exists.
    return [junction(head, b.length)];
  }
  if (am.length === 0 || am.length * bm.length > LCS_CELLS) {
    return span(head + 1, head + bm.length);
  }

  // Which middle lines of `after` are new or rewritten: those the LCS does
  // not pair with a line of `before`. A run of `before` lines with no partner
  // is a deletion; it marks the `after` line it left behind, as above.
  const paired = lcsPairs(am, bm);
  const marks = new Set<number>();
  let i = 0; // into am
  let j = 0; // into bm
  for (const [pi, pj] of paired) {
    if (j < pj) for (; j < pj; j++) marks.add(head + j + 1);
    if (i < pi) marks.add(junction(head + j, b.length));
    i = pi + 1;
    j = pj + 1;
  }
  for (; j < bm.length; j++) marks.add(head + j + 1);
  if (i < am.length) marks.add(junction(head + j, b.length));
  return [...marks].sort((x, y) => x - y);
}

/** The line (1-based) where a deletion before 0-based line `at` of `after`
 *  now reads differently: the line before the gap — the last one that
 *  survives — or the first line when the gap is at the top. */
function junction(at: number, length: number): number {
  return Math.min(Math.max(at, 1), Math.max(length, 1));
}

function span(from: number, to: number): number[] {
  const lines: number[] = [];
  for (let n = from; n <= to; n++) lines.push(n);
  return lines;
}

/** Index pairs (i, j) of the longest common subsequence of `a` and `b`, in
 *  order. Classic table, then a walk back from the far corner. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const m = a.length;
  const n = b.length;
  const w = n + 1;
  // L[i][j] = LCS length of a[i..] and b[j..], stored flat.
  const L = new Uint32Array((m + 1) * w);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      L[i * w + j] =
        a[i] === b[j]
          ? L[(i + 1) * w + j + 1] + 1
          : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
