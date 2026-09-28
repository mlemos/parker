// The highlighting tags of Parker's own markdown, and the parser a note is read
// with. No DOM and no CodeMirror view here: the note painter (paint.ts) runs
// this very parser on the iPhone, inside JavaScriptCore.
import { styleTags } from "@lezer/highlight";
import { parser, Strikethrough } from "@lezer/markdown";
import type { MarkdownConfig } from "@lezer/markdown";
import { Highlight } from "./highlight";
import { todoBlocks } from "./todo-markdown";

import { highlightTag, inlineCodeTag } from "./md-tag-defs";
export { highlightTag, inlineCodeTag };

/** Inline code gets a tag of its own (inlineCodeTag).
 *  `/...` so the backticks (CodeMark, a mark with no style of its own) are inside the span. */
const mdTags: MarkdownConfig = { props: [styleTags({ "InlineCode/...": inlineCodeTag })] };

/** What Parker adds to CommonMark: ~~strikethrough~~ (GFM), ==highlight==,
 *  to-dos as blocks of their own, and the inline-code tag — and only those.
 *  Tables and autolinks stay with the code that already handles them. */
export const noteExtensions = [Strikethrough, Highlight, todoBlocks, mdTags];

/** A note's parser, as the editor has it, minus the languages nested in it
 *  (HTML, and code fences that name a language), which the editor loads
 *  lazily and the painter leaves as plain fence text. */
export const noteParser = parser.configure(noteExtensions);
