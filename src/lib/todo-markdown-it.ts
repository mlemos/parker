// The preview's half of the to-do rendering.
//
// The editor draws a to-do line as a coloured line with a checkbox widget. The
// preview used to draw it as literal text — "/DONE Shipped" — inside whatever
// block markdown happened to put it in, which was rarely the right one: an
// entry became a loose paragraph, its sub-items became a list belonging to
// nobody, and two entries in a row merged into a single paragraph because
// markdown joins consecutive lines.
//
// So this is a block rule, not a post-processing pass over the HTML. It claims
// the to-do line *and* the lines nested under it, which makes the group a real
// container: the children render inside their entry, and the entry's colour
// simply cascades to them the way colour does.
//
// A to-do is a list item (25/09): a run of them at one indentation is one
// <ul class="todo-list">, each an <li> — what a screen reader, a copy into
// Mail or a export expects. And the rule runs before setext headings, so a
// "-" or "=" typed under a to-do can't underline it into an <h2>: only a
// paragraph can be underlined, and a to-do isn't one.

import type { MarkdownIt, StateBlock, Token } from "markdown-it";
import { LINE_TAG, norm, priorityOf } from "./todo-model";
import { todoBoxHtml } from "./todo-glyph";

/** Indentation of a line, in the units markdown-it counts. */
const indentAt = (state: StateBlock, line: number): number =>
  state.sCount[line] ?? 0;

const isEmpty = (state: StateBlock, line: number): boolean =>
  state.isEmpty(line);

export function todoPlugin(md: MarkdownIt): void {
  md.block.ruler.before("lheading", "parker_todo", todoRule, {
    alt: ["paragraph", "blockquote", "list"],
  });
  md.renderer.rules.parker_todo_list_open = (tokens: Token[], i: number) =>
    `<ul class="todo-list"${md.renderer.renderAttrs(tokens[i])}>`;
  md.renderer.rules.parker_todo_list_close = () => `</ul>`;
  md.renderer.rules.parker_todo_open = (tokens: Token[], i: number) => {
    const state = tokens[i].info;
    const priority = (tokens[i].meta as { priority?: number } | null)?.priority ?? 0;
    // The line map's attribute rides along; nothing else is on the token.
    return (
      `<li class="todo todo-${state.toLowerCase()}"${md.renderer.renderAttrs(tokens[i])}>` +
      `<div class="todo-head">${todoBoxHtml(state, priority)}`
    );
  };
  md.renderer.rules.parker_todo_text_close = () => `</div>`;
  md.renderer.rules.parker_todo_close = () => `</li>`;
}

/** The to-do tag on a line, or null. Only where the editor sees one: with
    nothing but whitespace before it on the source line. Inside a list item or
    a quote markdown-it has moved the line's start past the marker, so
    "- /TODO x" would otherwise read as a to-do here and as a list item whose
    text starts with a slash there; the raw line is what both sides agree on. */
function tagAt(state: StateBlock, line: number): RegExpExecArray | null {
  const start = state.bMarks[line] + state.tShift[line];
  const lineStart = state.src.lastIndexOf("\n", start - 1) + 1;
  if (!/^\s*$/.test(state.src.slice(lineStart, start))) return null;
  return LINE_TAG.exec(state.src.slice(start, state.eMarks[line]));
}

function todoRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean
): boolean {
  if (!tagAt(state, startLine)) return false;
  // Four columns past the block's indent is an indented code block, as it is
  // for "- item".
  if (indentAt(state, startLine) - state.blkIndent >= 4) return false;
  if (silent) return true;

  const own = indentAt(state, startLine);
  const list = state.push("parker_todo_list_open", "ul", 1);
  list.block = true;

  // Entries at this indentation, one after another — a blank line between
  // two of them doesn't end the list, as it doesn't for "- item".
  let line = startLine;
  let last = startLine;
  for (;;) {
    last = entry(state, line, endLine, own);
    let next = last + 1;
    while (next < endLine && isEmpty(state, next)) next++;
    if (next >= endLine || indentAt(state, next) !== own || !tagAt(state, next)) break;
    line = next;
  }
  list.map = [startLine, last + 1];

  state.push("parker_todo_list_close", "ul", -1);
  state.line = last + 1;
  return true;
}

/** One entry: the to-do line and what is nested under it. Returns its last line. */
function entry(state: StateBlock, startLine: number, endLine: number, own: number): number {
  const tag = tagAt(state, startLine)!;
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];

  // The entry runs until something steps back out to this level or further.
  // Blank lines are transparent: an empty line between two sub-items has not
  // left the nesting. Trailing blanks are not claimed, though — they belong to
  // whatever comes next.
  let last = startLine;
  let line = startLine + 1;
  while (line < endLine) {
    if (isEmpty(state, line)) {
      line++;
      continue;
    }
    if (indentAt(state, line) <= own) break;
    last = line;
    line++;
  }

  const open = state.push("parker_todo_open", "li", 1);
  open.info = norm(tag[2]);
  open.meta = { priority: priorityOf(tag) };
  open.map = [startLine, last + 1];
  open.block = true;

  // The rest of the line, as inline content — so `code`, links and emphasis on
  // a to-do work exactly as they do anywhere else.
  const text = state.push("inline", "", 0);
  text.content = state.src.slice(start + tag[0].length, max).trim();
  text.map = [startLine, startLine + 1];
  text.children = [];
  state.push("parker_todo_text_close", "div", -1);

  // The nested lines, parsed as markdown in their own right. blkIndent is
  // raised so their indentation is relative to the entry, which is what makes
  // a sub-list a sub-list instead of a code block.
  if (last > startLine) {
    const oldIndent = state.blkIndent;
    state.blkIndent = own + 1;
    state.md.block.tokenize(state, startLine + 1, last + 1);
    state.blkIndent = oldIndent;
  }

  state.push("parker_todo_close", "li", -1);
  return last;
}
