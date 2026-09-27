// Markdown extension: a to-do line is a block of its own.
//
// Without this, a `/TAG` line pays for markdown's lazy-continuation rule.
// Sitting in column 0 does *not* close a list — a paragraph inside a list item
// keeps absorbing unindented lines until a blank one shows up. So a to-do
// written directly under a sub-item becomes part of that item, and gets the
// list's colour instead of its own. Two to-dos in a row merge into one
// paragraph, which is worse: they read as a single entry.
//
// CSS can't fix that. The only selector strong enough to beat syntax
// highlighting is `.cm-todo-line-X span`, which flattens *every* span on the
// line — that is why a /DOING line already loses the colour of `inline code`.
// Winning on paint means losing the markup underneath.
//
// So the tag wins where it should: in the structure. `endLeaf` tells the
// parser that this line closes whatever text block was open, the same way a
// heading or a blockquote does. Then the to-do line simply isn't inside the
// list, and nothing has to fight over its colour.
//
// And the line is a block of its own — a TodoLine, not a paragraph (25/09).
// As a paragraph it could still be turned into a heading: a "-" alone on the
// line below, typed on the way to "- item", is Markdown's underline for a
// heading, and the to-do above flashed bold in the heading colour. Only a
// paragraph can be underlined, so a TodoLine can't. Its text is parsed as
// inline content, so code, links and emphasis on a to-do work as before.

// And what is nested under a to-do belongs to it (27/09), as in the preview
// (todo-markdown-it.ts): a to-do is a TodoItem, a composite block like a list
// item, that holds its TodoLine and every line after it indented past the tag
// — blank lines don't end it. Inside, indentation counts from the to-do's
// column plus one, the preview's blkIndent = own + 1: so a line four spaces in
// under a to-do is its text, not an indented code block, and its *emphasis*
// is emphasis.

import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import { LINE_TAG } from "./todo-model";

/** Whether this line steps out of a to-do's body. A paragraph would carry on
 *  into it anyway — CommonMark's lazy continuation — where the preview ends
 *  the body at the first line back at the to-do's column. `line.depth` (how
 *  many open blocks the line continued) isn't in @lezer/markdown's types, but
 *  it is what its own lazy-continuation check reads. */
function leavesTodo(cx: BlockContext, line: Line): boolean {
  const continued = (line as unknown as { depth: number }).depth;
  for (let d = continued; d < cx.depth; d++) if (cx.parentType(d).name === "TodoItem") return true;
  return false;
}

export const todoBlocks: MarkdownConfig = {
  defineNodes: [
    { name: "TodoLine", block: true },
    {
      name: "TodoItem",
      block: true,
      // Goes on while a line is blank or indented past the to-do's column.
      composite(_cx, line, value) {
        if (line.indent < line.baseIndent + value && line.next > -1) return false;
        line.moveBaseColumn(line.baseIndent + value);
        return true;
      },
    },
  ],
  parseBlock: [
    {
      name: "ParkerTodoLine",
      parse(cx: BlockContext, line: Line) {
        // Four columns in is an indented code block, as it is for a list item.
        if (line.indent - line.baseIndent >= 4) return false;
        const text = line.text.slice(line.pos);
        const tag = LINE_TAG.exec(text);
        if (!tag) return false;
        cx.startComposite("TodoItem", line.pos, line.indent - line.baseIndent + 1);
        const from = cx.lineStart + line.pos + tag[1].length;
        const content = text.slice(tag[1].length);
        cx.addElement(cx.elt("TodoLine", from, from + content.length, cx.parser.parseInline(content, from)));
        // The head is taken; what's left of the line is nothing.
        line.moveBase(line.text.length);
        return null;
      },
      endLeaf: (cx, line) => LINE_TAG.test(line.text) || leavesTodo(cx, line),
    },
  ],
};
