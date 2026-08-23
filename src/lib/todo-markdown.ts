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

import type { MarkdownConfig } from "@lezer/markdown";
import { LINE_TAG } from "./todo-model";

export const todoBlocks: MarkdownConfig = {
  parseBlock: [
    {
      name: "ParkerTodoLine",
      // Not a parser — only a boundary. The line still parses as an ordinary
      // paragraph afterwards, which is exactly what it should look like.
      endLeaf: (_cx, line) => LINE_TAG.test(line.text),
    },
  ],
};
