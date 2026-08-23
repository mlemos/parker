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
    expect(html("/DONE Shipped")).toContain('class="cm-todo-box cm-todo-box-done"');
    // The check, verbatim from the editor's path data.
    expect(html("/DONE Shipped")).toContain('d="M20 6 9 17l-5-5"');
  });

  // The open state is an empty box; drawing nothing in it is the point.
  it("leaves the open state's box empty", () => {
    const out = html("/TODO Next");
    expect(out).toContain('class="cm-todo-box cm-todo-box-todo"');
    expect(out).not.toContain("<svg");
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
      "<div><div></div></div><div><div></div></div>"
    );
    const out = html("/TODO First\n/TODO Second");
    expect(out).toContain("First");
    expect(out).toContain("Second");
  });

  // Sub-items used to become a list belonging to nobody, rendered as a sibling
  // of the entry rather than inside it.
  it("puts the nested lines inside their entry", () => {
    expect(shape("/DONE Shipped\n  - one\n  - two")).toBe(
      "<div><div></div><ul><li></li><li></li></ul></div>"
    );
  });

  // An empty line between two sub-items has not left the nesting — both items
  // stay inside the entry. (Markdown makes the list loose, hence the <p>s.)
  it("reads through a blank line inside a group", () => {
    expect(shape("/DONE Shipped\n  - one\n\n  - two")).toBe(
      "<div><div></div><ul><li><p></p></li><li><p></p></li></ul></div>"
    );
  });

  it("ends the group when the text steps back out", () => {
    const out = shape("/DONE Shipped\n  - one\nback at the margin");
    expect(out).toBe("<div><div></div><ul><li></li></ul></div><p></p>");
  });

  it("nests a to-do inside a to-do", () => {
    const out = html("/DOING Outer\n  /TODO Inner");
    expect(out).toContain("todo todo-doing");
    expect(out).toContain("todo todo-todo");
    expect(out.indexOf("todo-todo")).toBeGreaterThan(out.indexOf("todo-doing"));
  });

  it("renders inline markup on the entry", () => {
    const out = html("/TODO Run `pnpm test` and see [docs](https://example.org)");
    expect(out).toContain("<code>pnpm test</code>");
    expect(out).toContain('<a href="https://example.org">docs</a>');
  });
});

describe("what the preview leaves alone", () => {
  it("does not touch an ordinary list", () => {
    expect(shape("- one\n- two")).toBe("<ul><li></li><li></li></ul>");
  });

  it("does not touch a word that only looks like a tag", () => {
    for (const line of ["/TODOS many", "/DO it", "TODO no slash"])
      expect(html(line), line).not.toContain("cm-todo-box");
  });

  it("leaves a tag inside a fenced code block as code", () => {
    const out = html("```\n/TODO inside a fence\n```");
    expect(out).toContain("<code>");
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
