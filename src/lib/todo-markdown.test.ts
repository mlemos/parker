import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightTree, tags as t } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { todoBlocks } from "./todo-markdown.ts";

const parse = (doc: string, on = true) =>
  syntaxTree(
    EditorState.create({
      doc,
      extensions: [markdown(on ? { extensions: [todoBlocks] } : {})],
    })
  );

/** The node path over the first occurrence of `needle`. */
function pathOver(doc: string, needle: string, on = true): string[] {
  const at = doc.indexOf(needle);
  const path: string[] = [];
  parse(doc, on).iterate({
    from: at,
    to: at + 1,
    enter: (n) => {
      path.push(n.name);
    },
  });
  return path;
}

/** The text ranges the theme's list colour would paint. */
function listColoured(doc: string, on = true): string[] {
  const style = HighlightStyle.define([{ tag: [t.list], class: "L" }]);
  const out: string[] = [];
  highlightTree(parse(doc, on), style, (from, to) => out.push(doc.slice(from, to)));
  return out;
}

const ENTRY_THEN_TODO = "/DONE Shipped\n  - a detail\n/TODO Next thing\n";

describe("a to-do line as its own block", () => {
  // The bug this exists for: in column 0 but still inside the list item above,
  // because a paragraph in a list swallows unindented lines until a blank one.
  it("is not swallowed by the sub-item above it", () => {
    expect(pathOver(ENTRY_THEN_TODO, "/TODO", false)).toEqual([
      "Document",
      "BulletList",
      "ListItem",
      "Paragraph",
    ]);
    expect(pathOver(ENTRY_THEN_TODO, "/TODO")).toEqual(["Document", "TodoLine"]);
  });

  it("keeps the list's colour off it", () => {
    expect(listColoured(ENTRY_THEN_TODO, false)).toEqual(["  - a detail\n/TODO Next thing"]);
    expect(listColoured(ENTRY_THEN_TODO)).toEqual(["  - a detail"]);
  });

  // Two entries in a row used to render as one paragraph — markdown joins
  // consecutive lines, so they read as a single to-do.
  it("does not merge with the to-do before it", () => {
    const doc = "/TODO First\n/TODO Second\n";
    const paragraphs: string[] = [];
    parse(doc).iterate({
      enter: (n) => {
        if (n.name === "TodoLine") paragraphs.push(doc.slice(n.from, n.to));
      },
    });
    expect(paragraphs).toEqual(["/TODO First", "/TODO Second"]);
  });

  it("breaks out of a plain paragraph too", () => {
    const doc = "Some prose about the release.\n/TODO Not part of that sentence\n";
    expect(pathOver(doc, "/TODO")).toEqual(["Document", "TodoLine"]);
  });

  it("works for every state, and for the aliases", () => {
    for (const tag of [
      "TODO", "DOING", "PAUSE", "WAIT", "ATTN", "DONE", "FAIL", "CANCEL",
      "WIP", "PAUSED", "HOLD", "WAITING", "BLOCKED", "MISSED", "DISMISSED",
    ]) {
      const doc = `/DONE Shipped\n  - a detail\n/${tag} Next\n`;
      expect(pathOver(doc, `/${tag}`), tag).toEqual(["Document", "TodoLine"]);
    }
  });
});

// A to-do line is a block of its own, not a paragraph (25/09). As a paragraph
// it could be turned into a heading: a "-" typed on the line below — on its
// way to "- item" — is Markdown's underline for a heading, and "Sub Todo"
// flashed bold in the heading colour.
describe("a to-do line is not a paragraph", () => {
  const nodes = (doc: string) => {
    const names: string[] = [];
    parse(doc).iterate({ enter: (n) => void names.push(n.name) });
    return names;
  };

  it("can't be underlined into a heading", () => {
    for (const doc of [
      "/TODO Main Todo\n  /TODO Sub Todo\n  -",
      "/TODO Main Todo\n-",
      "/TODO Main Todo\n===",
      "  /DONE Sub\n  ---",
    ]) {
      const names = nodes(doc);
      expect(names.filter((n) => n.startsWith("SetextHeading")), doc).toEqual([]);
      expect(names, doc).toContain("TodoLine");
    }
  });

  it("still underlines ordinary text into a heading", () => {
    expect(nodes("A title\n---")).toContain("SetextHeading2");
  });

  it("keeps inline markup on the to-do's text", () => {
    const names = nodes("/TODO Run `pnpm test` and read **this** [doc](https://example.org)");
    expect(names).toEqual(expect.arrayContaining(["TodoLine", "InlineCode", "StrongEmphasis", "Link"]));
  });

  it("covers the line from the tag, indentation and container aside", () => {
    const doc = "- item\n  /TODO nested task";
    let span = "";
    parse(doc).iterate({ enter: (n) => void (n.name === "TodoLine" && (span = doc.slice(n.from, n.to))) });
    expect(span).toBe("/TODO nested task");
  });

  it("leaves a line after it to be its own block", () => {
    const names = nodes("/TODO a\nmore text");
    expect(names).toEqual(["Document", "TodoLine", "Paragraph"]);
  });
});

describe("what it leaves alone", () => {
  it("does not disturb an ordinary list", () => {
    const doc = "- one\n- two\n";
    expect(pathOver(doc, "two")).toEqual([
      "Document",
      "BulletList",
      "ListItem",
      "Paragraph",
    ]);
  });

  it("keeps sub-items under their entry", () => {
    const doc = "/DONE Shipped\n  - first\n  - second\n";
    expect(listColoured(doc)).toEqual(["  - first\n  - second"]);
  });

  // A word that merely starts like a tag is not one — the grammar in
  // todo-model draws that line, and the block boundary has to agree.
  it("ignores lines that only look like a tag", () => {
    for (const line of ["/TODOS many", "/DO it", "TODO no slash", "text /TODO mid-line"]) {
      const doc = `/DONE Shipped\n  - a detail\n${line}\n`;
      expect(pathOver(doc, line.slice(0, 4)), line).toContain("ListItem");
    }
  });

  // Inside a fence the text is code, not structure. Block parsers don't run
  // there, and a backlog pasted into a code block must stay verbatim.
  it("does not reach inside a fenced code block", () => {
    const doc = "```\n/TODO inside a fence\n```\n";
    expect(pathOver(doc, "/TODO")).toContain("FencedCode");
  });
});
