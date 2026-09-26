// ==Highlight== in the editor: an inline extension for @lezer/markdown, cut
// from its own Strikethrough — the same delimiter rules, with "==" for "~~".
// No standard has it; Obsidian, Bear, Typora and markdown-it-mark agree on
// it, and the preview uses markdown-it-mark for the same syntax.
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";
import { highlightTag } from "./themes";

const Delim = { resolve: "Highlight", mark: "HighlightMark" };
const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\xA1\u2010-\u2027]/;

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 61 /* '=' */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);
        return cx.addDelimiter(
          Delim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter)
        );
      },
      after: "Emphasis",
    },
  ],
};
