// Pure to-do logic: tag grammar, state machine, and the edits ⌘⏎ / clicking
// produce. No CodeMirror view, no DOM — it works on a minimal document
// interface (satisfied by CodeMirror's Text), so it can be unit-tested
// headlessly. todo.ts owns the rendering and wires these into transactions.

/** Slash tag at the start of a line (after optional indent). */
export const LINE_TAG =
  /^(\s*)\/(TODO|DOING|WIP|PAUSED|PAUSE|HOLD|WAITING|WAIT|BLOCKED|ATTN|DONE|FAIL|MISSED|CANCEL|DISMISSED)(?=\s|$)/;

/** ⌘⏎ rotation order: the states you pass through, then the outcomes.
    The aliases (WIP, WAITING/BLOCKED, MISSED, DISMISSED) normalize to their
    canonical state on any interaction. */
export const ORDER = [
  "TODO",
  "DOING",
  "PAUSE",
  "WAIT",
  "ATTN",
  "DONE",
  "FAIL",
  "CANCEL",
] as const;
export type State = (typeof ORDER)[number];

/** Alias → canonical state. Canonical tags are the short form; the longer
    spellings people reach for are aliases that normalize on any interaction.

    Three ways a task can be "not moving", and they are genuinely different:
      /PAUSE  you stopped it — nothing external is missing, you chose to park it
      /WAIT   someone else has it — you cannot move it even if you wanted to
      /ATTN   it needs *you* — the next move is yours and you haven't made it */
const ALIASES: Record<string, State> = {
  WIP: "DOING",
  PAUSED: "PAUSE",
  HOLD: "PAUSE",
  WAITING: "WAIT",
  BLOCKED: "WAIT",
  MISSED: "FAIL",
  DISMISSED: "CANCEL",
};

export const norm = (s: string): State => ALIASES[s] ?? (s as State);

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

/** The states that mean "still on your plate" — a plain click completes them,
    and anything else is an outcome a plain click reopens. */
const OPEN = new Set<State>(["TODO", "DOING", "PAUSE", "WAIT", "ATTN"]);

/** The state a checkbox click moves to: plain click completes/reopens, ⌥-click
    cycles the paused/waiting/attention/fail/cancel states. */
export function nextOnClick(cur: State, alt: boolean): State {
  if (!alt) return OPEN.has(cur) ? "DONE" : "TODO";
  switch (cur) {
    case "TODO":
      return "DOING";
    case "DOING":
      return "PAUSE";
    case "PAUSE":
      return "WAIT";
    case "WAIT":
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

// ---- Grouping --------------------------------------------------------------
// A to-do owns the lines nested under it. Ownership is indentation: a line
// belongs to the nearest to-do above it that is *less* indented, and the group
// ends at the first line that steps back out to that level or further. Blank
// lines are transparent — an empty line between two sub-items has not left the
// nesting, it is just an empty line.
//
// To-dos can nest, so this is a stack rather than a single current owner.

/** How far a line is indented, counting a tab as one level like the text does. */
const indentOf = (text: string): number => /^[ \t]*/.exec(text)![0].length;

const isBlank = (text: string): boolean => text.trim() === "";

/** How far back to look for the start of the enclosing group when the caller
 *  asks about a line in the middle of a document. Bounded so a file with no
 *  unindented line anywhere can't turn this into a full-document scan. */
const LOOKBACK = 500;

/**
 * For each line in `[fromLine, toLine]`, the state of the to-do that owns it —
 * or null when nothing does, including for the to-do lines themselves, which
 * wear their own state rather than inheriting one.
 *
 * Correct regardless of where the range starts: it walks back to the enclosing
 * unindented line first, because a viewport can open anywhere.
 */
export function ownersForRange(
  doc: DocLike,
  fromLine: number,
  toLine: number
): (State | null)[] {
  let start = fromLine;
  const floor = Math.max(1, fromLine - LOOKBACK);
  while (start > floor) {
    const text = doc.line(start).text;
    if (!isBlank(text) && indentOf(text) === 0) break; // a root line: nothing above it can own us
    start--;
  }

  const stack: { indent: number; state: State }[] = [];
  const owners: (State | null)[] = [];

  for (let n = start; n <= toLine; n++) {
    const { text } = doc.line(n);
    let owner: State | null = null;

    if (!isBlank(text)) {
      const indent = indentOf(text);
      // Stepping back to this level or further leaves those groups behind.
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();

      const tag = LINE_TAG.exec(text);
      if (tag) {
        stack.push({ indent, state: norm(tag[2]) });
      } else if (stack.length) {
        owner = stack[stack.length - 1].state;
      }
    }

    if (n >= fromLine) owners.push(owner);
  }
  return owners;
}
