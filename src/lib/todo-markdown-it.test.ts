import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.ts";

const html = (src: string) => renderMarkdown(src);
/** Block tags in order, stripped of attributes — the shape of the output,
 *  which is what these are actually about. */
const shape = (src: string) =>
  (html(src).match(/<\/?(?:div|ul|ol|li|p|h\d)\b[^>]*>/g) ?? [])
    .map((tag) => tag.replace(/\s[^>]*>/, ">"))
    .join("");

describe("to-do entries in the preview", () => {
  it("renders as a to-do, not as the literal text", () => {
    const out = html("/DONE Shipped it");
    expect(out).toContain('class="todo todo-done"');
    expect(out).toContain("Shipped it");
    expect(out).not.toContain("/DONE");
  });

  it("draws the state's box, with the editor's glyph", () => {
    expect(html("/DONE Shipped")).toContain('class="cm-todo-box cm-todo-box-done cm-todo-box-p0"');
    // The check, verbatim from the editor's path data.
    expect(html("/DONE Shipped")).toContain('d="M20 6 9 17l-5-5"');
  });

  // The open state is an empty box; drawing nothing in it is the point.
  it("leaves the open state's box empty", () => {
    const out = html("/TODO Next");
    expect(out).toContain('class="cm-todo-box cm-todo-box-todo cm-todo-box-p0"');
    expect(out).not.toContain("<svg");
  });

  // The priority travels to the box as a level class; the CSS colours the
  // empty box's border with it and leaves filled boxes alone.
  it("carries the priority bangs to the box", () => {
    expect(html("/TODO!! Next")).toContain('class="cm-todo-box cm-todo-box-todo cm-todo-box-p2"');
    expect(html("/DOING!!! Now")).toContain('class="cm-todo-box cm-todo-box-doing cm-todo-box-p3"');
    expect(html("/TODO !! Next")).toContain('class="cm-todo-box cm-todo-box-todo cm-todo-box-p0"');
  });

  it("knows every state, and normalises the aliases", () => {
    const states = ["TODO", "DOING", "PAUSE", "WAIT", "ATTN", "DONE", "FAIL", "CANCEL"];
    for (const s of states) expect(html(`/${s} x`), s).toContain(`todo todo-${s.toLowerCase()}`);
    for (const [alias, canonical] of [
      ["WIP", "doing"],
      ["PAUSED", "pause"],
      ["HOLD", "pause"],
      ["WAITING", "wait"],
      ["BLOCKED", "wait"],
      ["MISSED", "fail"],
      ["DISMISSED", "cancel"],
    ])
      expect(html(`/${alias} x`), alias).toContain(`todo todo-${canonical}`);
  });

  // Two entries used to merge: markdown joins consecutive lines into one
  // paragraph, so two to-dos read as a single one.
  it("keeps two entries in a row apart", () => {
    expect(shape("/TODO First\n/TODO Second")).toBe(
      "<ul><li><div></div></li><li><div></div></li></ul>"
    );
    const out = html("/TODO First\n/TODO Second");
    expect(out).toContain("First");
    expect(out).toContain("Second");
  });

  // Sub-items used to become a list belonging to nobody, rendered as a sibling
  // of the entry rather than inside it.
  it("puts the nested lines inside their entry", () => {
    expect(shape("/DONE Shipped\n  - one\n  - two")).toBe(
      "<ul><li><div></div><ul><li></li><li></li></ul></li></ul>"
    );
  });

  // An empty line between two sub-items has not left the nesting — both items
  // stay inside the entry. (Markdown makes the list loose, hence the <p>s.)
  it("reads through a blank line inside a group", () => {
    expect(shape("/DONE Shipped\n  - one\n\n  - two")).toBe(
      "<ul><li><div></div><ul><li><p></p></li><li><p></p></li></ul></li></ul>"
    );
  });

  it("ends the group when the text steps back out", () => {
    const out = shape("/DONE Shipped\n  - one\nback at the margin");
    expect(out).toBe("<ul><li><div></div><ul><li></li></ul></li></ul><p></p>");
  });

  it("nests a to-do inside a to-do", () => {
    const out = html("/DOING Outer\n  /TODO Inner");
    expect(out).toContain("todo todo-doing");
    expect(out).toContain("todo todo-todo");
    expect(out.indexOf("todo-todo")).toBeGreaterThan(out.indexOf("todo-doing"));
  });

  it("nests a to-do's own list inside its entry", () => {
    expect(shape("/DOING Outer\n  /TODO Inner")).toBe(
      "<ul><li><div></div><ul><li><div></div></li></ul></li></ul>"
    );
  });

  it("renders inline markup on the entry", () => {
    const out = html("/TODO Run `pnpm test` and see [docs](https://example.org)");
    expect(out).toContain("<code>pnpm test</code>");
    expect(out).toContain('<a href="https://example.org" title="https://example.org">docs</a>');
  });
});

describe("what the preview leaves alone", () => {
  it("does not touch an ordinary list", () => {
    expect(shape("- one\n- two")).toBe("<ul><li></li><li></li></ul>");
  });

  // The editor's rule: a tag counts only with nothing but whitespace before
  // it on the line. After a list marker or a quote's ">" it is text, as it is
  // there — a list item whose text starts with a slash.
  it("leaves a tag after a list marker as the item's text, as the editor does", () => {
    const out = html("- /TODO after a marker\n- plain");
    expect(out).not.toContain("todo-list");
    expect(out).toContain("/TODO after a marker");
    expect(shape("- /TODO after a marker\n- plain")).toBe("<ul><li></li><li></li></ul>");
  });

  it("leaves a tag after a quote marker as the quote's text", () => {
    const out = html("> /DONE in a quote");
    expect(out).not.toContain("todo-list");
    expect(out).toContain("/DONE in a quote");
  });

  it("still takes an indented tag under a list item, as the editor does", () => {
    const out = html("- item\n  /TODO under the item");
    expect(out).toContain('class="todo todo-todo"');
    expect(out).not.toContain("/TODO under");
  });

  it("does not touch a word that only looks like a tag", () => {
    for (const line of ["/TODOS many", "/DO it", "TODO no slash"])
      expect(html(line), line).not.toContain("cm-todo-box");
  });

  it("leaves a tag inside a fenced code block as code", () => {
    const out = html("```\n/TODO inside a fence\n```");
    expect(out).toMatch(/<code[^>]*>/);
    expect(out).toContain("/TODO inside a fence");
    expect(out).not.toContain("cm-todo-box");
  });

  it("still escapes raw HTML on a to-do line", () => {
    const out = html("/TODO <script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("still refuses a javascript: link on a to-do line", () => {
    expect(html("/TODO [x](javascript:alert(1))")).not.toContain("href");
  });
});

// To-dos are list items (25/09): a run of them is one <ul class="todo-list">,
// each an <li> — for screen readers, for copying into Mail or Docs, and so a
// line under a to-do can't turn it into a heading.
describe("to-dos as a list", () => {
  it("makes a run of to-dos one list, each an item", () => {
    const out = html("/TODO First\n/DONE Second\n/WAIT Third");
    expect(out.match(/<ul class="todo-list"/g)?.length).toBe(1);
    expect(out.match(/<li class="todo /g)?.length).toBe(3);
    expect(out).toContain('<li class="todo todo-done"');
  });

  it("keeps a blank line between to-dos inside the same list", () => {
    expect(shape("/TODO a\n\n/TODO b")).toBe("<ul><li><div></div></li><li><div></div></li></ul>");
  });

  it("starts a new list after text in between", () => {
    expect(shape("/TODO a\nbetween\n\n/TODO b")).toBe(
      "<ul><li><div></div></li></ul><p></p><ul><li><div></div></li></ul>"
    );
  });

  it("keeps the source line on each item, for scroll sync", () => {
    const out = html("/TODO a\n/TODO b");
    expect(out).toMatch(/<li class="todo todo-todo"[^>]*data-line="1"/);
    expect(out).toMatch(/<li class="todo todo-todo"[^>]*data-line="2"/);
  });

  // The scene that showed it: "-" typed under a sub-task, on its way to
  // "- item", made "/TODO Sub Todo" a heading with its raw tag on screen.
  it("never turns a to-do into a heading", () => {
    for (const src of [
      "/TODO Main Todo\n  /TODO Sub Todo\n  -",
      "/TODO Main Todo\n-",
      "/TODO Main Todo\n===",
    ]) {
      const out = html(src);
      expect(out, src).not.toMatch(/<h\d/);
      expect(out, src).not.toContain("/TODO");
      expect(out, src).toContain("Main Todo");
    }
  });

  it("still underlines ordinary text into a heading", () => {
    expect(html("A title\n---")).toContain("<h2");
  });
});
