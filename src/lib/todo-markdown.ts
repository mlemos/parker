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

import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import { LINE_TAG } from "./todo-model";

export const todoBlocks: MarkdownConfig = {
  defineNodes: [{ name: "TodoLine", block: true }],
  parseBlock: [
    {
      name: "ParkerTodoLine",
      parse(cx: BlockContext, line: Line) {
        const text = line.text.slice(line.pos);
        const tag = LINE_TAG.exec(text);
        if (!tag) return false;
        const from = cx.lineStart + line.pos + tag[1].length;
        const content = text.slice(tag[1].length);
        cx.addElement(cx.elt("TodoLine", from, from + content.length, cx.parser.parseInline(content, from)));
        cx.nextLine();
        return true;
      },
      endLeaf: (_cx, line) => LINE_TAG.test(line.text),
    },
  ],
};
