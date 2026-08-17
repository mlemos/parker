// Pure to-do logic: tag grammar, state machine, and the edits ⌘⏎ / clicking
// produce. No CodeMirror view, no DOM — it works on a minimal document
// interface (satisfied by CodeMirror's Text), so it can be unit-tested
// headlessly. todo.ts owns the rendering and wires these into transactions.

/** Slash tag at the start of a line (after optional indent). */
export const LINE_TAG =
  /^(\s*)\/(TODO|DOING|WIP|ATTN|DONE|FAIL|MISSED|CANCEL|DISMISSED)(?=\s|$)/;

/** ⌘⏎ rotation order: the states you pass through, then the outcomes.
    WIP/MISSED/DISMISSED normalize to their canonical state on any interaction. */
export const ORDER = ["TODO", "DOING", "ATTN", "DONE", "FAIL", "CANCEL"] as const;
export type State = (typeof ORDER)[number];

export const norm = (s: string): State =>
  (s === "WIP"
    ? "DOING"
    : s === "MISSED"
      ? "FAIL"
      : s === "DISMISSED"
        ? "CANCEL"
        : s) as State;

export interface DocLine {
  from: number;
  to: number;
  number: number;
  text: string;
}
export interface DocLike {
  length: number;
  lines: number;
  lineAt(pos: number): DocLine;
  line(n: number): DocLine;
}

export type Change = { from: number; to?: number; insert?: string };

/** Edit that rewrites a line's tag to `next` (null removes it, plus the one
    space that separated it from the text). */
export function tagChange(
  line: { from: number; text: string },
  tag: RegExpExecArray,
  next: string | null
): Change {
  const from = line.from + tag[1].length;
  const tagEnd = from + 1 + tag[2].length;
  if (next) return { from, to: tagEnd, insert: "/" + next };
  const hasSpace = line.text[tag[0].length] === " ";
  return { from, to: tagEnd + (hasSpace ? 1 : 0) };
}

/** The state a checkbox click moves to: plain click completes/reopens, ⌥-click
    cycles the attention/fail/cancel outcomes. */
export function nextOnClick(cur: State, alt: boolean): State {
  if (!alt)
    return cur === "TODO" || cur === "DOING" || cur === "ATTN"
      ? "DONE"
      : "TODO";
  switch (cur) {
    case "TODO":
      return "DOING";
    case "DOING":
      return "ATTN";
    case "ATTN":
      return "FAIL";
    case "FAIL":
      return "CANCEL";
    case "CANCEL":
      return "TODO";
    default:
      return "ATTN"; // DONE → needs another look
  }
}

/** The next state in the ⌘⏎ rotation; null means "remove the tag". */
export function nextInRotation(cur: string): State | null {
  const i = ORDER.indexOf(norm(cur));
  return i + 1 < ORDER.length ? ORDER[i + 1] : null;
}

/**
 * The edits ⌘⏎ should apply for a selection spanning [from, to].
 *
 * One rule covers both the single-line and multi-line cases: if any candidate
 * line lacks a tag, tag those lines /TODO (leaving already-tagged lines alone);
 * otherwise advance every line one step through the rotation.
 *
 * Line selection follows the editor convention that a selection ending at
 * column 0 does not include that line — but only when it spans more than one
 * line, so a cursor resting at the start of a line still acts on that line.
 * Blank lines are skipped when several lines are selected; a lone cursor on a
 * blank line still gets a tag (that's how you start a new to-do).
 */
export function planRotate(doc: DocLike, from: number, to: number): Change[] {
  const startLine = doc.lineAt(from);
  const endLine =
    to > from && to > startLine.to && doc.lineAt(to).from === to
      ? doc.lineAt(to - 1)
      : doc.lineAt(to);

  const multi = endLine.number > startLine.number;
  const lines: { line: DocLine; tag: RegExpExecArray | null }[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = doc.line(n);
    if (multi && line.text.trim() === "") continue;
    lines.push({ line, tag: LINE_TAG.exec(line.text) });
  }
  if (lines.length === 0) return [];

  const untagged = lines.filter((l) => !l.tag);
  if (untagged.length) {
    return untagged.map(({ line }) => ({
      from: line.from + /^\s*/.exec(line.text)![0].length,
      insert: "/TODO ",
    }));
  }
  return lines.map(({ line, tag }) =>
    tagChange(line, tag!, nextInRotation(tag![2]))
  );
}

/**
 * Where the cursor belongs after `changes` are applied, or null to let the
 * editor map it as usual.
 *
 * Inserting a tag at the start of the cursor's own line is the case that needs
 * help: the editor maps a position to *before* text inserted at it, which would
 * leave the cursor in front of "/TODO " — so the next thing typed lands outside
 * the tag. Park it after the tag (and its space) instead, ready to type.
 */
export function cursorAfterRotate(
  changes: Change[],
  head: number
): number | null {
  if (changes.length !== 1) return null; // multi-line: keep the selection
  const c = changes[0];
  if (c.to !== undefined || !c.insert) return null; // rewrote/removed a tag
  const inserted = c.insert.length;
  const mapped = head >= c.from ? head + inserted : head;
  return Math.max(mapped, c.from + inserted);
}
