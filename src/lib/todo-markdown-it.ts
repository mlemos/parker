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

import type { MarkdownIt, StateBlock, Token } from "markdown-it";
import { LINE_TAG, norm } from "./todo-model";
import { todoBoxHtml } from "./todo-glyph";

/** Indentation of a line, in the units markdown-it counts. */
const indentAt = (state: StateBlock, line: number): number =>
  state.sCount[line] ?? 0;

const isEmpty = (state: StateBlock, line: number): boolean =>
  state.isEmpty(line);

export function todoPlugin(md: MarkdownIt): void {
  md.block.ruler.before("paragraph", "parker_todo", todoRule, {
    alt: ["paragraph", "blockquote", "list"],
  });
  md.renderer.rules.parker_todo_open = (tokens: Token[], i: number) => {
    const state = tokens[i].info;
    return (
      `<div class="todo todo-${state.toLowerCase()}">` +
      `<div class="todo-head">${todoBoxHtml(state)}`
    );
  };
  md.renderer.rules.parker_todo_text_close = () => `</div>`;
  md.renderer.rules.parker_todo_close = () => `</div>`;
}

function todoRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const tag = LINE_TAG.exec(state.src.slice(start, max));
  if (!tag) return false;
  if (silent) return true;

  const own = indentAt(state, startLine);

  // The group runs until something steps back out to this level or further.
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

  const open = state.push("parker_todo_open", "div", 1);
  open.info = norm(tag[2]);
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

  state.push("parker_todo_close", "div", -1);
  state.line = last + 1;
  return true;
}
