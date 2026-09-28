// Parker's own highlighting tags, in a module of their own: md-tags.ts builds
// the parser from highlight.ts, and highlight.ts needs its tag first.
import { Tag, tags as t } from "@lezer/highlight";

/** Inline code, as a tag of its own under monospace — so it can carry a class
    the fenced code text (also monospace) does not. */
export const inlineCodeTag = Tag.define(t.monospace);
/** ==Highlighted== text — a node of Parker's own (lib/highlight.ts), so a tag
    of its own. */
export const highlightTag = Tag.define();
